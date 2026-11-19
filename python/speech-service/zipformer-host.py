"""Run a sherpa-onnx streaming Zipformer model on a private Unix socket."""
import argparse
import base64
import json
from pathlib import Path
import socketserver
import subprocess
import sys
import threading
import wave

SAMPLE_RATE = 16000
FRAME_SAMPLES = 800
RIGHT_PADDING_SAMPLES = int(0.66 * SAMPLE_RATE)


def model_component(directory, component):
    files = [path for path in directory.glob(f"{component}*.onnx") if path.is_file()]
    quantized = [path for path in files if path.name.endswith((".int8.onnx", "-int8.onnx"))]
    candidates = quantized or files
    if len(candidates) != 1:
        raise ValueError(f"Expected one {component} ONNX file for the selected precision in {directory}")
    return str(candidates[0])


def audio_frames(path):
    try:
        wav = wave.open(path, "rb")
    except (wave.Error, EOFError):
        wav = None
    if wav:
        with wav:
            if (wav.getframerate(), wav.getnchannels(), wav.getsampwidth()) == (SAMPLE_RATE, 1, 2):
                while chunk := wav.readframes(FRAME_SAMPLES):
                    yield chunk
                return

    # Browser uploads and alternative WAV formats use the same PCM as live capture.
    command = [
        "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-i", path,
        "-f", "s16le", "-acodec", "pcm_s16le", "-ac", "1", "-ar", str(SAMPLE_RATE), "pipe:1",
    ]
    with subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL) as decoder:
        try:
            while chunk := decoder.stdout.read(FRAME_SAMPLES * 2):
                yield chunk
            if decoder.wait():
                raise ValueError("Could not decode the recording")
        finally:
            if decoder.poll() is None:
                decoder.kill()


class Zipformer:
    def __init__(self, directory, threads):
        import numpy as np
        import sherpa_onnx

        tokens = directory / "tokens.txt"
        if not tokens.is_file():
            raise ValueError(f"Missing tokens.txt in {directory}")
        self.recognizer = sherpa_onnx.OnlineRecognizer.from_transducer(
            encoder=model_component(directory, "encoder"),
            decoder=model_component(directory, "decoder"),
            joiner=model_component(directory, "joiner"),
            tokens=str(tokens),
            sample_rate=SAMPLE_RATE,
            feature_dim=80,
            num_threads=threads,
            decoding_method="greedy_search",
            enable_endpoint_detection=False,
            provider="cpu",
        )
        self.np = np
        self.lock = threading.Lock()

    def recognize_file(self, path):
        session = ZipformerSession(self)
        for chunk in audio_frames(path):
            session.append(chunk)
        return session.finish()


class ZipformerSession:
    def __init__(self, model, send=None):
        self.model = model
        self.send = send
        self.pending_byte = b""
        self.previous = ""
        self.has_audio = False
        self.finished = False
        with model.lock:
            self.stream = model.recognizer.create_stream()

    def decode(self):
        recognizer = self.model.recognizer
        while recognizer.is_ready(self.stream):
            recognizer.decode_stream(self.stream)

    def append(self, audio):
        if self.finished:
            return
        pcm = self.pending_byte + audio
        complete = len(pcm) // 2 * 2
        self.pending_byte = pcm[complete:]
        if not complete:
            return
        self.has_audio = True
        np = self.model.np
        samples = np.frombuffer(pcm[:complete], dtype="<i2").astype(np.float32) / 32768
        with self.model.lock:
            self.stream.accept_waveform(SAMPLE_RATE, samples)
            self.decode()
            text = self.model.recognizer.get_result(self.stream).strip() if self.send else ""
        if self.send and text != self.previous:
            self.previous = text
            self.send("partial", text)

    def finish(self):
        if self.finished:
            return
        self.finished = True
        text = ""
        if self.has_audio:
            np = self.model.np
            with self.model.lock:
                # Supply the remaining right context immediately when the button is released.
                self.stream.accept_waveform(SAMPLE_RATE, np.zeros(RIGHT_PADDING_SAMPLES, dtype=np.float32))
                self.stream.input_finished()
                self.decode()
                text = self.model.recognizer.get_result(self.stream).strip()
        if self.send:
            self.send("final", text)
        return text

def make_server(path, model):
    class Handler(socketserver.StreamRequestHandler):
        def handle(self):
            send = None
            try:
                self.connection.settimeout(60)
                line = self.rfile.readline(16_384)
                if not line:
                    return
                first = json.loads(line)
                session_id = first.get("id")
                if not isinstance(session_id, str):
                    return

                def send(kind, text=None):
                    payload = json.dumps({"type": kind, "id": session_id, "text": text})
                    self.connection.sendall(payload.encode() + b"\n")

                if first.get("type") == "file":
                    file_path = first.get("path")
                    if not isinstance(file_path, str) or not file_path:
                        send("error")
                        return
                    send("final", model.recognize_file(file_path))
                    return
                if first.get("type") != "start":
                    send("error")
                    return
                session = ZipformerSession(model, send)
                while line := self.rfile.readline(16_384):
                    message = json.loads(line)
                    if message.get("id") != session_id:
                        return
                    kind = message.get("type")
                    if kind == "audio":
                        session.append(base64.b64decode(message["pcm"], validate=True))
                    elif kind == "finish":
                        session.finish()
                        return
                    elif kind == "cancel":
                        return
            except (AttributeError, KeyError, OSError, RuntimeError, TypeError, ValueError):
                if send:
                    try:
                        send("error")
                    except OSError:
                        pass

    class Server(socketserver.ThreadingUnixStreamServer):
        daemon_threads = True

    return Server(path, Handler)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--socket", required=True)
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--threads", type=int, default=2)
    args = parser.parse_args()
    if args.threads < 1:
        parser.error("--threads must be positive")

    try:
        model = Zipformer(args.model_dir, args.threads)
        with make_server(args.socket, model) as server:
            print("[Zipformer] Offline ASR ready", flush=True)
            server.serve_forever()
    except (ImportError, ValueError, OSError, RuntimeError) as error:
        print(f"[Zipformer] {error}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())

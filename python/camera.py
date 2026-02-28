import argparse
import json
import os
import socket
import socketserver
import subprocess
import sys
import threading
import time
from PIL import Image

from utils import ImageUtils

try:
    from picamera2 import Picamera2
except ImportError:
    Picamera2 = None


def _default_web_frame_path() -> str:
    project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    return os.path.join(project_root, "data", "camera_feed", "web_live.jpg")


DAEMON_HOST = os.getenv("WHISPLAY_CAMERA_DAEMON_HOST", "127.0.0.1")
DAEMON_PORT = int(os.getenv("WHISPLAY_CAMERA_DAEMON_PORT", "18765"))
DAEMON_TIMEOUT_SEC = float(os.getenv("WHISPLAY_CAMERA_DAEMON_TIMEOUT_SEC", "2"))


class SharedCameraService:
    def __init__(self):
        self.web_frame_path = _default_web_frame_path()
        os.makedirs(os.path.dirname(self.web_frame_path), exist_ok=True)

        self.capture_width = max(64, int(os.getenv("WHISPLAY_CAMERA_WIDTH", "560")))
        self.capture_height = max(64, int(os.getenv("WHISPLAY_CAMERA_HEIGHT", "480")))
        interval_ms = int(os.getenv("WHISPLAY_CAMERA_DAEMON_INTERVAL_MS", "200"))
        self.stream_interval_sec = max(0.05, interval_ms / 1000)

        self.picam2 = None
        self.running = True
        self.stream_ref_count = 0
        self.state_lock = threading.Lock()
        self.camera_lock = threading.Lock()

        self.worker = threading.Thread(target=self._stream_loop, daemon=True)
        self.worker.start()

    def _ensure_camera_ready(self) -> None:
        if Picamera2 is None:
            raise RuntimeError("Picamera2 is unavailable")
        if self.picam2 is not None:
            return
        self.picam2 = Picamera2()
        self.picam2.configure(
            self.picam2.create_preview_configuration(
                main={"size": (self.capture_width, self.capture_height)}
            )
        )
        self.picam2.start()

    def _capture_frame_image(self) -> Image.Image:
        with self.camera_lock:
            self._ensure_camera_ready()
            frame = self.picam2.capture_array()
        image = Image.fromarray(frame)
        if image.mode != "RGB":
            image = image.convert("RGB")
        return image

    def _write_web_frame(self, image: Image.Image) -> None:
        temp_path = f"{self.web_frame_path}.tmp"
        image.save(temp_path, format="JPEG", quality=80)
        os.replace(temp_path, self.web_frame_path)

    def _stream_loop(self) -> None:
        while self.running:
            should_stream = False
            with self.state_lock:
                should_stream = self.stream_ref_count > 0
            if not should_stream:
                time.sleep(0.05)
                continue
            try:
                image = self._capture_frame_image()
                self._write_web_frame(image)
            except Exception:
                time.sleep(0.2)
                continue
            time.sleep(self.stream_interval_sec)

    def stop(self) -> None:
        self.running = False
        self.worker.join(timeout=1)
        with self.camera_lock:
            if self.picam2 is not None:
                try:
                    self.picam2.stop()
                except Exception:
                    pass
                self.picam2 = None

    def handle_command(self, payload: dict) -> dict:
        cmd = str(payload.get("cmd", "")).strip().lower()

        if cmd in ["status", "ping"]:
            with self.state_lock:
                active = self.stream_ref_count
            return {"ok": True, "stream_ref_count": active, "ready": Picamera2 is not None}

        if cmd == "start_stream":
            with self.state_lock:
                self.stream_ref_count += 1
                active = self.stream_ref_count
            return {"ok": True, "stream_ref_count": active}

        if cmd == "stop_stream":
            with self.state_lock:
                self.stream_ref_count = max(0, self.stream_ref_count - 1)
                active = self.stream_ref_count
            return {"ok": True, "stream_ref_count": active}

        if cmd == "capture":
            target = str(payload.get("path", "")).strip()
            if not target:
                return {"ok": False, "error": "missing capture path"}
            target_path = os.path.abspath(target)
            os.makedirs(os.path.dirname(target_path), exist_ok=True)
            try:
                image = self._capture_frame_image()
                image.save(target_path, format="JPEG", quality=95)
                return {"ok": True, "path": target_path}
            except Exception as e:
                return {"ok": False, "error": str(e)}

        return {"ok": False, "error": f"unknown command: {cmd}"}


SERVICE_INSTANCE = None


class CameraDaemonHandler(socketserver.StreamRequestHandler):
    def handle(self):
        global SERVICE_INSTANCE
        while True:
            raw = self.rfile.readline()
            if not raw:
                return
            try:
                payload = json.loads(raw.decode("utf-8").strip() or "{}")
            except Exception:
                self.wfile.write(b'{"ok": false, "error": "invalid json"}\n')
                self.wfile.flush()
                continue
            response = SERVICE_INSTANCE.handle_command(payload)
            self.wfile.write((json.dumps(response) + "\n").encode("utf-8"))
            self.wfile.flush()


class ThreadedTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True


def run_daemon(host: str, port: int) -> None:
    global SERVICE_INSTANCE
    SERVICE_INSTANCE = SharedCameraService()
    server = ThreadedTCPServer((host, port), CameraDaemonHandler)
    print(f"[CameraDaemon] Listening on {host}:{port}")
    try:
        server.serve_forever()
    finally:
        server.server_close()
        SERVICE_INSTANCE.stop()


def camera_daemon_request(
    cmd: str,
    payload: dict | None = None,
    timeout: float = DAEMON_TIMEOUT_SEC,
) -> dict:
    data = {"cmd": cmd}
    if payload:
        data.update(payload)
    with socket.create_connection((DAEMON_HOST, DAEMON_PORT), timeout=timeout) as sock:
        sock.sendall((json.dumps(data) + "\n").encode("utf-8"))
        sock_file = sock.makefile("r")
        line = sock_file.readline().strip()
        if not line:
            return {"ok": False, "error": "empty response"}
        return json.loads(line)


def ensure_camera_daemon(timeout_sec: float = 3.0) -> bool:
    try:
        response = camera_daemon_request("status", timeout=0.4)
        if response.get("ok"):
            return True
    except Exception:
        pass

    subprocess.Popen(
        [sys.executable, os.path.abspath(__file__), "--daemon"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        stdin=subprocess.DEVNULL,
        start_new_session=True,
    )

    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        try:
            response = camera_daemon_request("status", timeout=0.5)
            if response.get("ok"):
                return True
        except Exception:
            time.sleep(0.1)
    return False


class CameraThread(threading.Thread):
    def __init__(self, whisplay, image_path):
        super().__init__()
        self.whisplay = whisplay
        self.running = False
        self.capture_image = None
        self.image_path = image_path
        self.web_frame_path = _default_web_frame_path()
        self.frame_poll_sec = max(
            0.03,
            int(os.getenv("WHISPLAY_CAMERA_UI_POLL_MS", "80")) / 1000,
        )
        self._stream_started = False

    def start(self):
        self.running = True
        return super().start()

    def _draw_image_to_display(self, image: Image.Image) -> None:
        if image.mode != "RGB":
            image = image.convert("RGB")
        image = image.resize((self.whisplay.LCD_WIDTH, self.whisplay.LCD_HEIGHT), Image.LANCZOS)
        pixel_bytes = ImageUtils.image_to_rgb565(
            image,
            self.whisplay.LCD_WIDTH,
            self.whisplay.LCD_HEIGHT,
        )
        self.whisplay.draw_image(
            0,
            0,
            self.whisplay.LCD_WIDTH,
            self.whisplay.LCD_HEIGHT,
            pixel_bytes,
        )

    def run(self):
        if not ensure_camera_daemon():
            print("[Camera] Failed to connect/start camera daemon")
            return
        response = camera_daemon_request("start_stream")
        self._stream_started = bool(response.get("ok"))

        while self.running and self.capture_image is None:
            if os.path.exists(self.web_frame_path):
                try:
                    image = Image.open(self.web_frame_path).convert("RGB")
                    self._draw_image_to_display(image)
                except Exception:
                    pass
            time.sleep(self.frame_poll_sec)

        if self.capture_image is not None:
            self._draw_image_to_display(self.capture_image)
            time.sleep(2)

    def capture(self):
        response = camera_daemon_request("capture", {"path": self.image_path})
        if not response.get("ok"):
            print(f"[Camera] Capture failed: {response.get('error', 'unknown error')}")
            return
        if os.path.exists(self.image_path):
            self.capture_image = Image.open(self.image_path).convert("RGB")
            print(f"[Camera] Captured image saved to {self.image_path}")

    def stop(self):
        self.running = False
        if self._stream_started:
            try:
                camera_daemon_request("stop_stream")
            except Exception:
                pass
            self._stream_started = False
        if self.is_alive():
            self.join()


def _main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--daemon", action="store_true", help="Run camera daemon")
    parser.add_argument(
        "--ensure-daemon",
        action="store_true",
        help="Ensure daemon is running and exit",
    )
    args = parser.parse_args()

    if args.ensure_daemon:
        ok = ensure_camera_daemon()
        print("[CameraDaemon] ready" if ok else "[CameraDaemon] failed")
        return 0 if ok else 1

    if args.daemon:
        run_daemon(DAEMON_HOST, DAEMON_PORT)
        return 0

    parser.print_help()
    return 0


if __name__ == "__main__":
    sys.exit(_main())

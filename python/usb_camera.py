import re
import shutil
import subprocess
import threading
import time

from PIL import Image


class UsbCamera:
    """Read the latest frame from a Linux V4L2 capture device."""

    def __init__(self, device: str, resolution: str):
        match = re.fullmatch(r"([1-9][0-9]*)x([1-9][0-9]*)", resolution)
        if not match:
            raise ValueError("WHISPLAY_USB_CAMERA_SIZE must be WIDTHxHEIGHT")
        self.size = tuple(map(int, match.groups()))
        self.frame_bytes = self.size[0] * self.size[1] * 3
        self.device = device
        self.latest = None
        self.frame_time = 0.0
        self.finished = False
        self.condition = threading.Condition()

        ffmpeg = shutil.which("ffmpeg")
        if ffmpeg is None:
            raise RuntimeError("FFmpeg is required for USB camera capture")
        self.process = subprocess.Popen(
            [
                ffmpeg, "-nostdin", "-loglevel", "error",
                "-f", "v4l2", "-video_size", resolution, "-i", device,
                "-an", "-vf", f"fps=10,scale={self.size[0]}:{self.size[1]}",
                "-threads", "1", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1",
            ],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
        )
        self.reader = threading.Thread(target=self._read_frames, daemon=True)
        self.reader.start()

    def _read_frames(self) -> None:
        # Drain the pipe continuously so the shutter can use a recent frame.
        try:
            while True:
                frame = self.process.stdout.read(self.frame_bytes)
                if len(frame) != self.frame_bytes:
                    break
                with self.condition:
                    self.latest = frame
                    self.frame_time = time.monotonic()
                    self.condition.notify_all()
        finally:
            with self.condition:
                self.finished = True
                self.condition.notify_all()

    def capture(self) -> Image.Image:
        with self.condition:
            self.condition.wait_for(
                lambda: self.finished or (
                    self.latest is not None and time.monotonic() - self.frame_time < 1
                ),
                timeout=1.5,
            )
            if self.finished or self.latest is None or time.monotonic() - self.frame_time >= 1:
                raise RuntimeError(f"No video frame received from USB camera {self.device}")
            frame = self.latest
        return Image.frombytes("RGB", self.size, frame)

    def close(self) -> None:
        self.process.terminate()
        try:
            self.process.wait(timeout=0.5)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait()
        self.reader.join()
        self.process.stdout.close()

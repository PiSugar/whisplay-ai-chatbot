import json
import mmap
import os
import socket
import threading
import time

try:
    from whisplay import WhisplayBoard
except Exception:
    import sys
    sys.path.append(os.path.abspath("../Driver"))
    from WhisPlay import WhisPlayBoard

DEFAULT_DAEMON_SOCKET_PATH = "/tmp/whisplay-daemon.sock"
DEFAULT_APP_ID = "whisplay-ai-chatbot"
DEFAULT_APP_DISPLAY_NAME = "AI Chatbot"
DEFAULT_APP_ICON = "AI"


class WhisplayDaemonProxy:
    LCD_WIDTH = 240
    LCD_HEIGHT = 280
    CornerHeight = 20

    def __init__(
        self,
        socket_path: str = DEFAULT_DAEMON_SOCKET_PATH,
        app_id: str = DEFAULT_APP_ID,
        display_name: str = DEFAULT_APP_DISPLAY_NAME,
        icon: str = DEFAULT_APP_ICON,
        launch_command: str | None = None,
        launch_cwd: str | None = None,
        persist: bool = True,
    ):
        self.socket_path = socket_path
        self.button_press_callback = None
        self.button_release_callback = None
        self.exit_request_callback = None
        self.focus_revoked_callback = None
        self._button_down = False
        self._subscriber = None
        self._running = False
        self._mmap = None
        self._fb_file = None
        self._fb_stride = self.LCD_WIDTH * 2
        self._fb_path = None
        self._session_token = None
        self._app_id = app_id
        self._display_name = display_name
        self._icon = icon
        self._launch_command = launch_command
        self._launch_cwd = launch_cwd
        self._persist = persist

    def _send_request(self, cmd: str, payload: dict | None = None) -> dict:
        body = {"version": 1, "cmd": cmd, "payload": payload or {}}
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.connect(self.socket_path)
            client.sendall((json.dumps(body) + "\n").encode("utf-8"))
            line = client.makefile("r").readline().strip()
            if not line:
                raise RuntimeError("empty response from whisplay-daemon")
            response = json.loads(line)
            if not response.get("ok"):
                raise RuntimeError(response.get("error", "whisplay-daemon request failed"))
            return response

    def ping(self) -> bool:
        try:
            self._send_request("health.ping")
            return True
        except Exception:
            return False

    def register(self):
        payload = {
            "app_id": self._app_id,
            "display_name": self._display_name,
            "icon": self._icon,
            "persist": self._persist,
        }
        if self._launch_command is not None:
            payload["launch_command"] = self._launch_command
        if self._launch_cwd is not None:
            payload["cwd"] = self._launch_cwd
        self._send_request("app.register", payload)

    def acquire_foreground(self, timeout_sec: float = 5.0):
        deadline = time.time() + timeout_sec
        last_error = None
        while time.time() < deadline:
            try:
                response = self._send_request("app.focus.acquire", {"app_id": self._app_id})
                self._session_token = response["payload"]["session_token"]
                fb = self._send_request(
                    "framebuffer.acquire",
                    {"app_id": self._app_id, "session_token": self._session_token},
                )["payload"]
                self._attach_framebuffer(fb["buffer_handle"], int(fb["stride"]))
                return
            except Exception as exc:
                last_error = exc
                time.sleep(0.2)
        raise RuntimeError(f"failed to acquire foreground: {last_error}")

    def _attach_framebuffer(self, buffer_handle: str, stride: int):
        self._detach_framebuffer()
        self._fb_path = buffer_handle
        self._fb_stride = stride
        self._fb_file = open(buffer_handle, "r+b")
        self._mmap = mmap.mmap(self._fb_file.fileno(), 0)

    def _detach_framebuffer(self):
        if self._mmap is not None:
            try:
                self._mmap.close()
            except Exception:
                pass
            self._mmap = None
        if self._fb_file is not None:
            try:
                self._fb_file.close()
            except Exception:
                pass
            self._fb_file = None
        self._fb_path = None

    def release_focus(self):
        if self._session_token:
            try:
                self._send_request(
                    "app.focus.release",
                    {"app_id": self._app_id, "session_token": self._session_token},
                )
            except Exception:
                pass
        self._session_token = None
        self._detach_framebuffer()

    def prepare_exit(self):
        self.release_focus()

    def set_backlight(self, brightness):
        self._send_request("backlight.set", {"brightness": int(brightness)})

    def set_rgb(self, r, g, b):
        self._send_request("led.set", {"r": int(r), "g": int(g), "b": int(b)})

    def set_rgb_fade(self, r_target, g_target, b_target, duration_ms=100):
        self._send_request(
            "led.fade",
            {
                "r": int(r_target),
                "g": int(g_target),
                "b": int(b_target),
                "duration_ms": int(duration_ms),
            },
        )

    def draw_image(self, x, y, width, height, pixel_data):
        if self._mmap is None:
            return
        frame_bytes = bytes(pixel_data if not isinstance(pixel_data, bytes) else pixel_data)
        row_bytes = width * 2
        for row in range(height):
            src = row * row_bytes
            dst = ((y + row) * self._fb_stride) + (x * 2)
            self._mmap[dst:dst + row_bytes] = frame_bytes[src:src + row_bytes]

    def fill_screen(self, color):
        if self._mmap is None:
            return
        high = (int(color) >> 8) & 0xFF
        low = int(color) & 0xFF
        self._mmap.seek(0)
        self._mmap.write(bytes([high, low]) * (self.LCD_WIDTH * self.LCD_HEIGHT))
        self._mmap.seek(0)

    def button_pressed(self):
        return self._button_down

    def on_button_press(self, callback):
        self.button_press_callback = callback

    def on_button_release(self, callback):
        self.button_release_callback = callback

    def on_exit_request(self, callback):
        self.exit_request_callback = callback

    def on_focus_revoked(self, callback):
        self.focus_revoked_callback = callback

    def start_event_listener(self):
        if self._subscriber is not None:
            return
        self._running = True
        self._subscriber = threading.Thread(target=self._event_loop, daemon=True)
        self._subscriber.start()

    def _event_loop(self):
        while self._running:
            try:
                with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
                    client.connect(self.socket_path)
                    body = {"version": 1, "cmd": "events.subscribe", "payload": {"app_id": self._app_id}}
                    client.sendall((json.dumps(body) + "\n").encode("utf-8"))
                    reader = client.makefile("r")
                    ack = reader.readline().strip()
                    if not ack:
                        raise RuntimeError("subscription ack missing")
                    for line in reader:
                        if not self._running:
                            return
                        line = line.strip()
                        if not line:
                            continue
                        event = json.loads(line)
                        name = event.get("event")
                        payload = event.get("payload", {}) or {}
                        if name == "button_pressed":
                            self._button_down = True
                            if self.button_press_callback:
                                self.button_press_callback()
                        elif name == "button_released":
                            self._button_down = False
                            if self.button_release_callback:
                                self.button_release_callback()
                        elif name == "app_exit_requested":
                            if self.exit_request_callback:
                                self.exit_request_callback()
                        elif name == "app_focus_revoked":
                            self._session_token = None
                            self._detach_framebuffer()
                            if self.focus_revoked_callback:
                                self.focus_revoked_callback(payload)
            except Exception:
                time.sleep(0.5)

    def cleanup(self):
        self._running = False
        self.release_focus()


def create_whisplay_hardware(
    app_id: str = DEFAULT_APP_ID,
    display_name: str = DEFAULT_APP_DISPLAY_NAME,
    icon: str = DEFAULT_APP_ICON,
    launch_command: str | None = None,
    launch_cwd: str | None = None,
    persist: bool = True,
):
    socket_path = DEFAULT_DAEMON_SOCKET_PATH
    daemon = WhisplayDaemonProxy(
        socket_path=socket_path,
        app_id=app_id,
        display_name=display_name,
        icon=icon,
        launch_command=launch_command,
        launch_cwd=launch_cwd,
        persist=persist,
    )
    if daemon.ping():
        daemon.register()
        daemon.start_event_listener()
        daemon.acquire_foreground()
        return daemon
    return WhisplayBoard()

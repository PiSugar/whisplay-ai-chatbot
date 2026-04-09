"""Flask-based HTML web display for ChatWin.

Replaces the original Whisplay HAT LCD rendering pipeline with a browser
UI that any phone or laptop on the same network can open. State updates
are delivered via Server-Sent Events, so the browser needs no JavaScript
dependencies and reconnects automatically if ChatWin restarts.
"""

from __future__ import annotations

import copy
import json
import logging
import os
import queue
import threading
from typing import Any, Dict, List, Optional

log = logging.getLogger(__name__)

PACKAGE_DIR = os.path.dirname(os.path.abspath(__file__))
TEMPLATE_DIR = os.path.join(PACKAGE_DIR, "templates")
STATIC_DIR = os.path.join(PACKAGE_DIR, "static")


class WebDisplay:
    """Run a Flask app in a background thread and broadcast state."""

    def __init__(
        self,
        host: str = "0.0.0.0",
        port: int = 8080,
        title: str = "ChatWin",
        show_conversation: bool = True,
        **_: object,
    ) -> None:
        self.host = host
        self.port = int(port)
        self.title = title
        self.show_conversation = bool(show_conversation)

        self._lock = threading.Lock()
        self._subscribers: List[queue.Queue] = []
        self._state: Dict[str, Any] = {
            "status": "starting",
            "emoji": "",
            "text": "",
            "user_text": "",
            "conversation": [],
            "title": self.title,
            "show_conversation": self.show_conversation,
        }

        try:
            from flask import Flask, Response, jsonify, render_template  # type: ignore
        except ImportError as exc:  # pragma: no cover - runtime guard
            raise RuntimeError(
                "Flask is required for the web display. "
                "Install with `pip install flask`."
            ) from exc

        self._Response = Response
        self._jsonify = jsonify
        self._app = Flask(
            "chatwin",
            template_folder=TEMPLATE_DIR,
            static_folder=STATIC_DIR,
        )
        self._app.config["TEMPLATES_AUTO_RELOAD"] = False

        @self._app.route("/")
        def index():
            return render_template("index.html", title=self.title)

        @self._app.route("/state")
        def get_state():
            with self._lock:
                return self._jsonify(copy.deepcopy(self._state))

        @self._app.route("/events")
        def events():
            return self._Response(
                self._event_stream(), mimetype="text/event-stream"
            )

        self._server = None
        self._thread: Optional[threading.Thread] = None

    # ---- public API ----------------------------------------------------
    def start(self) -> None:
        """Start the Flask server in a background thread."""
        from werkzeug.serving import make_server  # type: ignore

        if self._thread is not None:
            return
        self._server = make_server(
            self.host, self.port, self._app, threaded=True
        )
        self._thread = threading.Thread(
            target=self._server.serve_forever,
            name="chatwin-web",
            daemon=True,
        )
        self._thread.start()
        log.info(
            "Web display listening on http://%s:%d/", self.host, self.port
        )

    def stop(self) -> None:
        if self._server is not None:
            try:
                self._server.shutdown()
            except Exception:  # pragma: no cover - shutdown best-effort
                log.debug("Flask server shutdown raised", exc_info=True)
            self._server = None
        if self._thread is not None:
            self._thread.join(timeout=2)
            self._thread = None
        # Wake any lingering SSE subscribers so they can exit.
        with self._lock:
            for q in self._subscribers:
                q.put(None)
            self._subscribers.clear()

    def update(self, **changes: Any) -> None:
        """Merge ``changes`` into state and push to all subscribers."""
        if not changes:
            return
        with self._lock:
            for key, value in changes.items():
                self._state[key] = value
            snapshot = copy.deepcopy(self._state)
            subscribers = list(self._subscribers)
        for q in subscribers:
            try:
                q.put(snapshot)
            except Exception:  # pragma: no cover
                log.debug("Failed to publish update", exc_info=True)

    def append_message(self, role: str, text: str, emoji: str = "") -> None:
        """Append a completed message to the conversation history."""
        if not text:
            return
        with self._lock:
            conversation = list(self._state.get("conversation") or [])
            conversation.append({"role": role, "text": text, "emoji": emoji})
            # Keep the history from growing without bound.
            if len(conversation) > 50:
                conversation = conversation[-50:]
            self._state["conversation"] = conversation
            snapshot = copy.deepcopy(self._state)
            subscribers = list(self._subscribers)
        for q in subscribers:
            try:
                q.put(snapshot)
            except Exception:  # pragma: no cover
                log.debug("Failed to publish append", exc_info=True)

    def get_state(self) -> Dict[str, Any]:
        with self._lock:
            return copy.deepcopy(self._state)

    # ---- SSE -----------------------------------------------------------
    def _event_stream(self):
        q: queue.Queue = queue.Queue(maxsize=64)
        with self._lock:
            self._subscribers.append(q)
            initial = copy.deepcopy(self._state)
        yield self._format_event(initial)
        try:
            while True:
                try:
                    item = q.get(timeout=20)
                except queue.Empty:
                    # Periodic comment keeps the proxy connection alive.
                    yield ": keepalive\n\n"
                    continue
                if item is None:
                    break
                yield self._format_event(item)
        finally:
            with self._lock:
                if q in self._subscribers:
                    self._subscribers.remove(q)

    @staticmethod
    def _format_event(payload: Dict[str, Any]) -> str:
        return "data: " + json.dumps(payload, ensure_ascii=False) + "\n\n"

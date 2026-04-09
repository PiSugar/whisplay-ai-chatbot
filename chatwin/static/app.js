(function () {
    "use strict";

    var statusEl = document.getElementById("status");
    var emojiEl = document.getElementById("emoji");
    var currentTextEl = document.getElementById("current-text");
    var userTextEl = document.getElementById("user-text");
    var conversationEl = document.getElementById("conversation");
    var conversationEmptyEl = document.getElementById("conversation-empty");
    var conversationSection = document.getElementById("conversation-section");
    var connectionLabel = document.getElementById("connection-label");

    var knownStates = [
        "starting", "idle", "listening", "transcribing",
        "thinking", "answering", "speaking", "error"
    ];

    function setBodyState(state) {
        var body = document.body;
        knownStates.forEach(function (s) {
            body.classList.remove("state-" + s);
        });
        if (state) {
            body.classList.add("state-" + state);
        }
    }

    function renderConversation(messages) {
        if (!Array.isArray(messages)) { messages = []; }
        conversationEl.innerHTML = "";
        messages.forEach(function (msg) {
            var li = document.createElement("li");
            li.className = "msg msg-" + (msg.role || "assistant");

            var role = document.createElement("span");
            role.className = "role";
            role.textContent = msg.role === "user" ? "You" : "Assistant";

            var text = document.createElement("span");
            text.className = "text";
            text.textContent = (msg.emoji ? msg.emoji + " " : "") + (msg.text || "");

            li.appendChild(role);
            li.appendChild(text);
            conversationEl.appendChild(li);
        });
        if (messages.length === 0) {
            conversationEmptyEl.hidden = false;
        } else {
            conversationEmptyEl.hidden = true;
            conversationEl.scrollTop = conversationEl.scrollHeight;
        }
    }

    function applyState(state) {
        if (!state || typeof state !== "object") { return; }

        if (state.title && document.title !== state.title) {
            document.title = state.title;
        }

        if (typeof state.status === "string") {
            statusEl.textContent = state.status;
            setBodyState(state.status);
        }

        if (typeof state.emoji === "string") {
            emojiEl.textContent = state.emoji || "•";
        }

        if (typeof state.text === "string") {
            currentTextEl.textContent = state.text;
        }

        if (typeof state.user_text === "string" && state.user_text.length > 0) {
            userTextEl.textContent = state.user_text;
            userTextEl.hidden = false;
        } else if (state.user_text === "") {
            userTextEl.hidden = true;
            userTextEl.textContent = "";
        }

        if (state.show_conversation === false) {
            conversationSection.hidden = true;
        } else {
            conversationSection.hidden = false;
            if (Array.isArray(state.conversation)) {
                renderConversation(state.conversation);
            }
        }
    }

    function setConnection(connected) {
        var body = document.body;
        if (connected) {
            body.classList.add("connected");
            body.classList.remove("disconnected");
            connectionLabel.textContent = "connected";
        } else {
            body.classList.add("disconnected");
            body.classList.remove("connected");
            connectionLabel.textContent = "reconnecting…";
        }
    }

    // Initial fetch so the user sees something even if SSE is slow.
    fetch("/state")
        .then(function (res) { return res.json(); })
        .then(applyState)
        .catch(function () { /* ignore — SSE will populate */ });

    function startEventStream() {
        if (typeof EventSource === "undefined") {
            connectionLabel.textContent = "SSE not supported";
            return;
        }
        var source = new EventSource("/events");
        source.onopen = function () { setConnection(true); };
        source.onerror = function () { setConnection(false); };
        source.onmessage = function (event) {
            try {
                var parsed = JSON.parse(event.data);
                applyState(parsed);
            } catch (err) {
                // swallow malformed payloads
            }
        };
    }

    startEventStream();
})();

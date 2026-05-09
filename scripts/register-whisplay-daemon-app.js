#!/usr/bin/env node

const fs = require("fs");
const net = require("net");
const path = require("path");

const SOCKET_PATH = "/tmp/whisplay-daemon.sock";
const APP_ID = "whisplay-ai-chatbot";
const DISPLAY_NAME = "AI Chatbot";
const ICON = "AI";

function sendRequest(socketPath, request) {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(socketPath);
    let buffer = "";
    client.setTimeout(1500);
    client.on("connect", () => {
      client.write(`${JSON.stringify(request)}\n`);
    });
    client.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const idx = buffer.indexOf("\n");
      if (idx >= 0) {
        const line = buffer.slice(0, idx).trim();
        client.end();
        if (!line) {
          reject(new Error("empty daemon response"));
          return;
        }
        try {
          resolve(JSON.parse(line));
        } catch (err) {
          reject(err);
        }
      }
    });
    client.on("timeout", () => {
      client.destroy(new Error("daemon request timed out"));
    });
    client.on("error", reject);
  });
}

async function main() {
  if (!fs.existsSync(SOCKET_PATH)) {
    console.log("[DaemonRegister] daemon socket not found, skip");
    return;
  }

  const repoRoot = process.cwd();
  const launchScript = path.join(repoRoot, "run_chatbot.sh");
  const logFile = path.join(repoRoot, "chatbot.log");
  const request = {
    version: 1,
    cmd: "app.register",
    payload: {
      app_id: APP_ID,
      display_name: DISPLAY_NAME,
      icon: ICON,
      launch_command: `bash ${launchScript} >> ${logFile} 2>&1`,
      cwd: repoRoot,
      persist: true,
    },
  };

  try {
    const res = await sendRequest(SOCKET_PATH, request);
    if (!res || !res.ok) {
      const reason = (res && res.error) || "unknown error";
      console.log(`[DaemonRegister] register failed: ${reason}`);
      return;
    }
    console.log("[DaemonRegister] app registered to whisplay-daemon");
  } catch (err) {
    console.log(`[DaemonRegister] skip register: ${err.message}`);
  }
}

main();

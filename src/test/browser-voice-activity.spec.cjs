const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

test("browser auto listening waits for speech and ends only after the configured trailing pause", () => {
  let measure;
  let now = 0;
  let level = 0;
  let stopped = 0;
  class AudioContext {
    state = "running";
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createAnalyser() {
      return { fftSize: 64, getFloatTimeDomainData(samples) { samples.fill(level); } };
    }
    async resume() {}
    async close() {}
  }
  const window = { AudioContext };
  const source = fs.readFileSync(path.join(__dirname, "../../web/shared/voice-activity.js"), "utf8");
  vm.runInNewContext(source, {
    window, performance: { now: () => now },
    setInterval(callback) { measure = callback; },
    clearInterval() { measure = undefined; },
  });
  const cleanup = window.watchForSpeechEnd({}, { silenceMs: 500, endLevelRatio: 0.5 }, () => { stopped++; });
  const sample = (value, time) => { level = value; now = time; measure(); };
  sample(0, 1000);
  sample(0, 2000);
  assert.equal(stopped, 0);
  sample(0.1, 2050);
  sample(0.1, 2100);
  sample(0, 2525);
  sample(0.08, 2550);
  sample(0, 2900);
  assert.equal(stopped, 0);
  sample(0, 3050);
  assert.equal(stopped, 1);
  cleanup();
});

test("automatic browser capture accepts the speech endpoint and discards audio after cancellation", async t => {
  const os = require("node:os");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "web-auto-capture-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bridgeSource = fs.readFileSync(path.join(__dirname, "../../dist/device/web-audio-bridge.js"), "utf8");
  const exports = {};
  vm.runInNewContext(bridgeSource, {
    exports, Buffer, setTimeout, clearTimeout, process: { env: {} },
    require: id => id === "../utils/dir" ? {} : require(id),
  });
  const bridge = exports.webAudioBridge;
  const events = [];
  bridge.setServer({ broadcastToWebClients: message => events.push(JSON.parse(message)) });
  const voiceActivity = { silenceMs: 500, endLevelRatio: 0.5 };
  const cancelledPath = path.join(dir, "cancelled.webm");
  const controller = new AbortController();
  const pending = bridge.startRecording(cancelledPath, 5, voiceActivity, controller.signal);
  bridge.handleAudioChunk(Buffer.from("discard this"));
  controller.abort();
  assert.deepEqual(events.splice(0), [{ type: "start_record", voiceActivity }, { type: "stop_record" }]);
  bridge.handleRecordComplete();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(fs.existsSync(cancelledPath), false);

  const completedPath = path.join(dir, "completed.webm");
  const completed = bridge.startRecording(completedPath, 5, voiceActivity);
  bridge.handleAudioChunk(Buffer.from("new audio"));
  bridge.handleRecordComplete();
  assert.equal(await completed, completedPath);
  assert.equal(fs.readFileSync(completedPath, "utf8"), "new audio");
});

test("Hat Plus browser playback cannot start after it was stopped during decoding", async () => {
  const script = fs.readFileSync(path.join(__dirname, "../../web/whisplay-hat-plus/app.js"), "utf8");
  const playback = script.slice(script.indexOf("let audioPlaybackGeneration"), script.indexOf("// ── Web Camera"));
  let finishDecode;
  const source = {
    connect() {},
    start() { starts++; },
  };
  let starts = 0;
  const events = [];
  const { playWebAudio, stopWebAudio } = vm.runInNewContext(
    `let currentAudioSource = null; ${playback}\n({ playWebAudio, stopWebAudio })`,
    {
      atob, console,
      ensureAudioContext: () => ({
        decodeAudioData: () => new Promise(resolve => { finishDecode = resolve; }),
        createBufferSource: () => source,
      }),
      sendJson: message => events.push(JSON.stringify(message)),
    },
  );

  const interrupted = playWebAudio("AA==", 1);
  stopWebAudio();
  finishDecode({});
  await interrupted;
  assert.equal(starts, 0);
  assert.deepEqual(events, []);

  const current = playWebAudio("AA==", 2);
  finishDecode({});
  await current;
  assert.equal(starts, 1);
  source.onended();
  assert.deepEqual(events, ['{"type":"play_complete","playId":2}']);
});

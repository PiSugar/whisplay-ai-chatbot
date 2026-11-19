const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PassThrough } = require("node:stream");
const { test } = require("node:test");
const vm = require("node:vm");
const wav = require("../../dist/utils/pcm-wav");
const source = fs.readFileSync(path.join(__dirname, "../../dist/device/audio.js"), "utf8");

function loadAudio(spawn) {
  const exports = {};
  vm.runInNewContext(source, {
    exports, Buffer, process: { env: {}, on() {} }, setTimeout, clearTimeout, console: { log() {} },
    require(id) {
      switch (id) {
        case "dotenv": return { config() {} };
        case "child_process": return { spawn };
        case "../cloud-api/server": return { asrServer: "zipformer" };
        case "../plugin": return { pluginRegistry: { getPlugin: () => undefined } };
        case "../type": return { TTSServer: { gemini: "gemini", piper: "piper" }, ASRServer: { zipformer: "zipformer" } };
        case "./audio-device": return { alsaInputDevice: "test-alsa", alsaOutputDevice: "test-alsa" };
        case "./web-audio-bridge": return { webAudioBridge: { isAvailable: () => false, stopPlayback() {} } };
        case "./voice-detect": return {};
        case "../utils/pcm-wav": return wav;
        default: return require(id);
      }
    },
  });
  return exports;
}

test("the fallback WAV and live recognizer both receive SoX's final PCM frame", async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "stream-pcm-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const output = path.join(directory, "speech.wav");
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill(signal) {
      assert.equal(signal, "SIGINT");
      this.emit("exit", 0);
      this.stdout.end(Buffer.from([4, 5, 6]));
      setImmediate(() => this.emit("close", 0));
    },
  });
  const exports = loadAudio((command, args) => {
    assert.equal(command, "sox");
    assert.deepEqual(Array.from(args.slice(-5)), ["signed-integer", "-b", "16", "-L", "-"]);
    return child;
  });
  const streamed = [];
  const capture = exports.recordAudioManually(output, audio => streamed.push(audio));
  child.stdout.write(Buffer.from([1, 2, 3]));
  capture.stop();
  assert.equal(await capture.result, output);
  const pcm = Buffer.from([1, 2, 3, 4, 5, 6]);
  assert.deepEqual(Buffer.concat(streamed), pcm);
  assert.deepEqual(fs.readFileSync(output), Buffer.concat([wav.pcm16WavHeader(6, 16000, 1), pcm]));
});


test("interrupting file playback kills SoX before allowing capture to proceed", async () => {
  const signals = [];
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stderr: new PassThrough(), exitCode: null, signalCode: null,
    kill(signal) { signals.push(signal); return true; },
  });
  const audio = loadAudio((command, args) => {
    assert.equal(command, "sox");
    assert.deepEqual(Array.from(args), ["-q", "reply.wav", "-t", "alsa", "test-alsa"]);
    return child;
  });
  const played = audio.playAudioData({ filePath: "reply.wav", duration: 3000 });
  audio.stopPlaying();
  assert.deepEqual(signals, ["SIGKILL"]);
  let closed = false;
  const barrier = audio.waitForPlaybackToStop().then(() => { closed = true; });
  await Promise.resolve();
  assert.equal(closed, false);
  child.emit("close", null, "SIGKILL");
  await Promise.all([barrier, played]);
  assert.equal(audio.waitForPlaybackToStop(), undefined);
});

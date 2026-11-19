const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../../dist/core/chat-flow/states.js"), "utf8");
const tick = () => new Promise(resolve => setImmediate(resolve));

function deferred() {
  let resolve;
  const promise = new Promise(finish => { resolve = finish; });
  return { promise, resolve };
}

function fixture({ runAnswers = false, playbackClosed, autoListening = false, noiseLevel,
  streamAutomatic = false, shouldEndAutoListening = () => false } = {}) {
  const exports = {};
  const recordings = [];
  const autoRecordings = [];
  const streams = [];
  const updates = [];
  const answers = [];
  const replies = [];
  let playbackWaits = 0;
  let stoppedReplies = 0;
  let chimes = 0;
  let released;
  let pressed;
  let time = 0;
  let batchCalls = 0;
  const fixtureModules = {
    "../../device/display": {
      display: value => updates.push(value),
      onButtonPressed: callback => { pressed = callback; },
      onButtonReleased: callback => { released = callback; },
      onButtonDoubleClick() {},
      onCameraModeExit() {}, onCameraShutterRequest() {}, onCameraBackRequest() {},
      onCameraModeRequest() {}, onTextInput() {},
      getCurrentStatus: () => Object.assign({ text: "" }, ...updates),
      isButtonDown: () => true,
    },
    "../../device/audio": {
      canStreamRecording: () => streamAutomatic || ctx.currentFlowName === "listening",
      waitForPlaybackToStop: () => playbackClosed,
      playWakeupChime: async () => { chimes++; },
      getDynamicVoiceDetectLevel: () => noiseLevel ?? Promise.resolve(2),
      recordAudio: (path, duration, level, signal, onPcm, finishSignal) => {
        const recording = deferred();
        autoRecordings.push({ path, duration, level, signal, recording, onPcm, finishSignal });
        return recording.promise;
      },
      recordAudioManually: (path, onPcm) => {
        const recording = deferred();
        const entry = { stopCount: 0, recording, path, onPcm };
        recordings.push(entry);
        return { result: recording.promise, stop: () => { entry.stopCount++; } };
      },
      recordFileFormat: "wav",
    },
    "../../cloud-api/server": {
      async chatWithLLMStream(_messages, partial, end) { replies.push({ partial, end }); },
      startRecordingStream: (onPartial, onEndpoint) => {
        const final = deferred();
        const stream = { onPartial, onEndpoint, finishCount: 0, cancelCount: 0, final, chunks: [],
          write(chunk) { this.chunks.push(chunk); },
          finish() { this.finishCount++; return final.promise; },
          cancel() { this.cancelCount++; final.resolve(undefined); },
        };
        streams.push(stream);
        return stream;
      },
    },
    "../../config/local-memory": { prepareMemoryPrompt: () => "", autoSaveExchange() {} },
    "../../device/music-player": { stopMusicPlayback() {} },
    "./camera-mode": { resetCameraModeControl() {}, onCameraModeExit() {} },
    "../../utils/image": { clearPendingCapturedImgForChat() {}, getLatestDisplayImg: () => "" },
    "../../utils/pcm-wav": require("../../dist/utils/pcm-wav"),
    "../../utils/hat-detect": { detectHatModel: () => "whisplay" },
    "node:perf_hooks": { performance: { now: () => time } },
  };
  vm.runInNewContext(source, {
    exports, AbortController, process: { env: {} }, Date: { now: () => time }, console: { log() {}, error() {} },
    require(id) {
      return fixtureModules[id] ?? (id === "moment" || id === "lodash" ? require(id) : {});
    },
  });
  const ctx = {
    answerId: 0, currentFlowName: "sleep", recordingsDir: "/fixture",
    autoListeningEnabled: autoListening,
    wakeRecordMaxSec: 12,
    wakeSessionActive: false,
    pauseWakeWordListener: async () => {},
    startWakeSession() {
      this.wakeSessionActive = true;
      this.wakeChimePending = true;
      this.transitionTo("wake_listening");
    },
    endWakeSession() { this.wakeSessionActive = false; },
    shouldContinueWakeSession() { return this.wakeSessionActive; },
    knowledgePrompts: [],
    resetToolCallDisplay() {},
    updateAnswerDisplayText(text) { this.answerDisplayText = text; },
    streamResponser: {
      partial() {}, endPartial() {}, stop() { stoppedReplies++; },
      async getPlayEndPromise() { playbackWaits++; },
    },
    shouldEndAutoListening,
    shouldEndAfterAnswer: () => false,
    recognizeAudio: async () => { batchCalls++; return "Fallback speech."; },
    transitionTo(state) {
      if (this.currentFlowName === "wake_listening") this.autoCapture?.cancel();
      if (!(state === "asr" &&
        (this.currentFlowName === "listening" || this.currentFlowName === "wake_listening"))) {
        this.recordingRecognition?.cancel();
        this.recordingRecognition = undefined;
      }
      this.currentFlowName = state;
      if (state === "answer") answers.push(this.asrText);
      if (state === "sleep" || state === "wake_listening" ||
          state === "listening" || state === "asr" || (runAnswers && state === "answer")) {
        exports.flowStates[state](this);
      }
    },
  };
  return {
    ctx, recordings, autoRecordings, streams, updates, answers, replies,
    playbackWaits: () => playbackWaits,
    stoppedReplies: () => stoppedReplies,
    chimes: () => chimes,
    batchCalls: () => batchCalls,
    release(ms) { time = ms; released(); },
    press() { pressed(); },
  };
}

test("a short press creates no final recognition or reply", async () => {
  const { ctx, recordings, streams, answers, release, batchCalls } = fixture();
  ctx.transitionTo("listening");
  release(100);
  recordings[0].recording.resolve(recordings[0].path);
  await tick();
  assert.equal(ctx.currentFlowName, "sleep");
  assert.equal(streams[0].cancelCount, 1);
  assert.equal(streams[0].finishCount, 0);
  assert.equal(batchCalls(), 0);
  assert.deepEqual(answers, []);
});

test("one press starts automatic listening and capture completion enters recognition", async () => {
  const f = fixture({ autoListening: true });
  f.ctx.transitionTo("sleep");
  f.press();
  f.release(100);
  await tick();
  assert.equal(f.ctx.currentFlowName, "wake_listening");
  assert.equal(f.chimes(), 1);
  assert.equal(f.recordings.length, 0);
  assert.equal(f.autoRecordings[0].level, 2);
  assert.equal(f.autoRecordings[0].duration, 12);
  f.autoRecordings[0].recording.resolve(f.autoRecordings[0].path);
  await tick();
  assert.deepEqual(f.answers, ["Fallback speech."]);
});

test("automatic conversation resumes detection after an answer without a second wake chime", async () => {
  const f = fixture({ autoListening: true, runAnswers: true });
  f.ctx.transitionTo("sleep");
  f.press();
  await tick();
  f.autoRecordings[0].recording.resolve(f.autoRecordings[0].path);
  await tick();
  f.replies[0].partial("An answer.");
  f.replies[0].end();
  await tick();
  assert.equal(f.ctx.currentFlowName, "wake_listening");
  assert.equal(f.autoRecordings.length, 2);
  assert.equal(f.chimes(), 1);
});

test("automatic capture displays revised subtitles and finalizes after the last PCM frame", async () => {
  const f = fixture({ autoListening: true, streamAutomatic: true });
  f.ctx.transitionTo("sleep");
  f.press();
  await tick();
  const [capture] = f.autoRecordings;
  const [stream] = f.streams;
  const first = Buffer.from([1, 2]);
  const last = Buffer.from([3, 4]);
  capture.onPcm(first);
  stream.onPartial("HEAR");
  stream.onPartial("HERE WE");
  assert.equal(f.updates.at(-1).text, "HERE WE");
  assert.equal(f.ctx.currentFlowName, "wake_listening");
  assert.equal(stream.finishCount, 0);
  stream.onEndpoint();
  assert.equal(capture.finishSignal.aborted, true);
  assert.equal(capture.signal.aborted, false);
  assert.equal(stream.finishCount, 0);
  capture.onPcm(last);
  capture.recording.resolve(capture.path);
  await tick();
  assert.equal(f.ctx.currentFlowName, "asr");
  assert.equal(stream.finishCount, 1);
  assert.deepEqual(stream.chunks, [first, last]);
  stream.final.resolve("HERE WE GO.");
  await tick();
  assert.deepEqual(f.answers, ["HERE WE GO."]);
  assert.equal(f.batchCalls(), 0);
});

test("automatic stream cancellation drops stale previews and a failed final falls back once", async () => {
  const f = fixture({ autoListening: true, streamAutomatic: true });
  f.ctx.transitionTo("sleep");
  f.press();
  await tick();
  f.press();
  const [oldStream] = f.streams;
  const [oldRecording] = f.autoRecordings;
  oldStream.onPartial("STALE");
  oldStream.onEndpoint();
  assert.equal(oldRecording.finishSignal.aborted, false);
  oldRecording.recording.resolve(oldRecording.path);
  await tick();
  assert.equal(f.ctx.currentFlowName, "sleep");
  assert.equal(oldStream.finishCount, 0);
  assert.ok(oldStream.cancelCount > 0);
  assert.ok(!f.updates.some(update => update.text === "STALE"));
  f.press();
  await tick();
  const current = f.autoRecordings[1];
  current.onPcm(Buffer.from([1, 2]));
  current.recording.resolve(current.path);
  await tick();
  f.streams[1].final.resolve(undefined);
  await tick();
  assert.equal(f.batchCalls(), 1);
  assert.deepEqual(f.answers, ["Fallback speech."]);
});

test("automatic listening acts on an end keyword only after final recognition", async () => {
  const f = fixture({
    autoListening: true, streamAutomatic: true, shouldEndAutoListening: text => text === "GOODBYE",
  });
  f.ctx.transitionTo("sleep");
  f.press();
  await tick();
  const [capture] = f.autoRecordings;
  const [stream] = f.streams;
  stream.onPartial("GOODBYE");
  assert.equal(f.ctx.currentFlowName, "wake_listening");
  capture.onPcm(Buffer.from([1, 2]));
  capture.recording.resolve(capture.path);
  await tick();
  stream.final.resolve("GOODBYE");
  await tick();
  assert.equal(f.ctx.currentFlowName, "sleep");
  assert.equal(f.ctx.wakeSessionActive, false);
  assert.deepEqual(f.answers, []);
});

test("cancelled automatic capture releases the mic before the next button session", async () => {
  const f = fixture({ autoListening: true });
  f.ctx.transitionTo("sleep");
  f.press();
  await tick();
  const first = f.autoRecordings[0];
  f.press();
  assert.equal(f.ctx.currentFlowName, "sleep");
  assert.equal(first.signal.aborted, true);
  f.press();
  await tick();
  assert.equal(f.autoRecordings.length, 1);
  first.recording.resolve(first.path);
  await tick();
  assert.equal(f.autoRecordings.length, 2);
  assert.equal(f.batchCalls(), 0);
});

test("pressing during ambient detection cancels before the recorder opens", async () => {
  const noise = deferred();
  const f = fixture({ autoListening: true, noiseLevel: noise.promise });
  f.ctx.transitionTo("sleep");
  f.press();
  await tick();
  f.press();
  noise.resolve(2);
  await tick();
  assert.equal(f.ctx.currentFlowName, "sleep");
  assert.equal(f.autoRecordings.length, 0);
});

test("pressing during recognition starts a new automatic session and discards the old result", async () => {
  const f = fixture({ autoListening: true });
  const old = deferred();
  f.ctx.recognizeAudio = () => old.promise;
  f.ctx.transitionTo("asr");
  f.press();
  await tick();
  assert.equal(f.ctx.currentFlowName, "wake_listening");
  assert.equal(f.autoRecordings.length, 1);
  old.resolve("Old speech.");
  await tick();
  assert.deepEqual(f.answers, []);
});

test("pressing during an answer stops playback before listening again", async () => {
  const playback = deferred();
  const f = fixture({ autoListening: true, runAnswers: true, playbackClosed: playback.promise });
  f.ctx.asrText = "Old question.";
  f.ctx.transitionTo("answer");
  await tick();
  f.press();
  await tick();
  assert.equal(f.stoppedReplies(), 1);
  assert.equal(f.ctx.currentFlowName, "wake_listening");
  assert.equal(f.autoRecordings.length, 0);
  playback.resolve();
  await tick();
  assert.equal(f.autoRecordings.length, 1);
  f.replies[0].end();
  await tick();
  assert.equal(f.ctx.currentFlowName, "wake_listening");
});

test("capture waits for playback to close and skips a press released while waiting", async () => {
  const playback = deferred();
  const f = fixture({ playbackClosed: playback.promise });
  f.ctx.transitionTo("listening");
  assert.equal(f.recordings.length, 0);
  f.release(40);
  playback.resolve();
  await tick();
  assert.equal(f.recordings.length, 0);
  assert.equal(f.ctx.currentFlowName, "sleep");
});

test("a new press isolates old subtitles and only the current final enters the answer state", async () => {
  const f = fixture();
  f.ctx.transitionTo("listening");
  f.streams[0].onPartial("first preview");
  f.release(700);
  assert.equal(f.ctx.currentFlowName, "asr");
  f.press();
  await tick();
  assert.equal(f.ctx.currentFlowName, "listening");
  f.streams[0].onPartial("old leaked preview");
  f.recordings[0].recording.resolve(f.recordings[0].path);
  f.streams[1].onPartial("new preview");
  f.recordings[1].onPcm(Buffer.alloc(16000));
  f.release(1500);
  f.recordings[1].recording.resolve(f.recordings[1].path);
  await tick();
  assert.equal(f.streams[0].finishCount, 0);
  assert.equal(f.streams[1].finishCount, 1);
  assert.deepEqual(f.answers, []);
  f.streams[1].final.resolve("New confirmed speech.");
  await tick();
  assert.equal(f.batchCalls(), 0);
  assert.deepEqual(f.answers, ["New confirmed speech."]);
  assert.ok(f.updates.some(update => update.text === "new preview"));
  assert.ok(!f.updates.some(update => update.text === "old leaked preview"));
});

test("a delayed ALSA start still requires half a second of captured audio", async () => {
  const { ctx, recordings, streams, answers, release, batchCalls } = fixture();
  ctx.transitionTo("listening");
  release(800);
  recordings[0].onPcm(Buffer.alloc(15998));
  recordings[0].recording.resolve(recordings[0].path);
  await tick();
  assert.equal(ctx.currentFlowName, "sleep");
  assert.equal(streams[0].finishCount, 0);
  assert.equal(batchCalls(), 0);
  assert.deepEqual(answers, []);
});

test("a failed stream falls back to the complete recording once", async () => {
  const f = fixture();
  f.ctx.transitionTo("listening");
  f.recordings[0].onPcm(Buffer.alloc(16000));
  f.release(750);
  f.recordings[0].recording.resolve(f.recordings[0].path);
  await tick();
  f.streams[0].final.resolve(undefined);
  await tick();
  assert.equal(f.batchCalls(), 1);
  assert.deepEqual(f.answers, ["Fallback speech."]);
});

test("interrupting a pending final does not start fallback for the old turn", async () => {
  const f = fixture();
  f.ctx.transitionTo("listening");
  f.recordings[0].onPcm(Buffer.alloc(16000));
  f.release(750);
  f.recordings[0].recording.resolve(f.recordings[0].path);
  await tick();
  assert.equal(f.streams[0].finishCount, 1);
  f.press();
  await tick();
  assert.equal(f.ctx.currentFlowName, "listening");
  assert.equal(f.batchCalls(), 0);
  assert.deepEqual(f.answers, []);
});

test("an interrupted reply cannot finish a new Zipformer turn", async () => {
  const f = fixture({ runAnswers: true });
  f.ctx.asrText = "Old question.";
  f.ctx.transitionTo("answer");
  await tick();
  assert.equal(f.replies.length, 1);
  f.press();
  f.recordings[0].onPcm(Buffer.alloc(16000));
  f.release(750);
  f.recordings[0].recording.resolve(f.recordings[0].path);
  await tick();
  f.streams[0].final.resolve("New question.");
  await tick();
  assert.equal(f.replies.length, 2);

  f.replies[0].end();
  await tick();
  assert.equal(f.playbackWaits(), 0);
  assert.equal(f.ctx.currentFlowName, "answer");
  f.replies[1].partial("New answer.");
  assert.equal(f.ctx.answerDisplayText, "New answer.");
  f.replies[1].end();
  await tick();
  assert.equal(f.playbackWaits(), 1);
  assert.equal(f.ctx.currentFlowName, "sleep");
});

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

function fixture({ runAnswers = false, playbackClosed } = {}) {
  const exports = {};
  const recordings = [];
  const streams = [];
  const updates = [];
  const answers = [];
  const replies = [];
  let playbackWaits = 0;
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
      isButtonDown: () => true,
    },
    "../../device/audio": {
      canStreamManualRecording: () => true,
      waitForPlaybackToStop: () => playbackClosed,
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
      startRecordingStream: onPartial => {
        const final = deferred();
        const stream = { onPartial, finishCount: 0, cancelCount: 0, final,
          write() {},
          finish() { this.finishCount++; return final.promise; },
          cancel() { this.cancelCount++; final.resolve(undefined); },
        };
        streams.push(stream);
        return stream;
      },
    },
    "../../config/local-memory": { prepareMemoryPrompt: () => "", autoSaveExchange() {} },
    "../../utils/image": { clearPendingCapturedImgForChat() {}, getLatestDisplayImg: () => "" },
    "../../utils/pcm-wav": require("../../dist/utils/pcm-wav"),
    "../../utils/hat-detect": { detectHatModel: () => "whisplay" },
    "node:perf_hooks": { performance: { now: () => time } },
  };
  vm.runInNewContext(source, {
    exports, process: { env: {} }, Date: { now: () => time }, console: { log() {}, error() {} },
    require(id) {
      return fixtureModules[id] ?? (id === "moment" || id === "lodash" ? require(id) : {});
    },
  });
  const ctx = {
    answerId: 0, currentFlowName: "sleep", recordingsDir: "/fixture",
    knowledgePrompts: [],
    resetToolCallDisplay() {},
    updateAnswerDisplayText(text) { this.answerDisplayText = text; },
    streamResponser: {
      partial() {}, endPartial() {}, stop() {},
      async getPlayEndPromise() { playbackWaits++; },
    },
    shouldEndAfterAnswer: () => false,
    recognizeAudio: async () => { batchCalls++; return "Fallback speech."; },
    transitionTo(state) {
      if (!(this.currentFlowName === "listening" && state === "asr")) {
        this.manualRecognition?.cancel();
        this.manualRecognition = undefined;
      }
      this.currentFlowName = state;
      if (state === "answer") answers.push(this.asrText);
      if (state === "listening" || state === "asr" || (runAnswers && state === "answer")) {
        exports.flowStates[state](this);
      }
    },
  };
  return {
    ctx, recordings, streams, updates, answers, replies,
    playbackWaits: () => playbackWaits,
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

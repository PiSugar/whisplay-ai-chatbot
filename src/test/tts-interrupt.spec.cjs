const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

test("a cancelled synthesis cannot restart the speaker during recording", async () => {
  const source = fs.readFileSync(path.join(__dirname, "../../dist/core/StreamResponsor.js"), "utf8");
  const exports = {};
  const played = [];
  let stops = 0;
  vm.runInNewContext(source, {
    exports, process: { env: {} }, setTimeout,
    console: { log() {}, time() {}, timeEnd() {} },
    require(id) {
      if (id === "../utils") return require("../../dist/utils");
      if (id === "../device/audio") return {
        async playAudioData(result) { played.push(result.filePath); },
        stopPlaying() { stops++; },
      };
      return require(id);
    },
  });
  let resolveOld;
  const old = new Promise(resolve => { resolveOld = resolve; });
  const responder = new exports.StreamResponser(text => {
    if (text.startsWith("Old")) return old;
    return Promise.resolve({ filePath: "new.wav", duration: 100 });
  });
  responder.partial("Old answer.");
  await Promise.resolve();
  responder.stop();
  resolveOld({ filePath: "old.wav", duration: 100 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stops, 1);
  assert.deepEqual(played, []);
  responder.partial("New answer.");
  responder.endPartial();
  await responder.getPlayEndPromise();
  assert.deepEqual(played, ["new.wav"]);
});

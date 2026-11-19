const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

test("configure lists Zipformer under Local Providers and the button settings under AI Features", () => {
  const file = path.join(__dirname, "../../dist/configure-env.js");
  const source = fs.readFileSync(file, "utf8");
  const groups = vm.runInNewContext(
    source.slice(0, source.lastIndexOf("\nmain()")) + "\nbuildGroupedSections(parseTemplate())",
    {
      __dirname: path.dirname(file), exports: {},
      require: id => id === "readline/promises" ? { createInterface() {} } : require(id),
    },
  );
  const sectionEntries = (groupKey, title) => {
    const group = groups.find(entry => entry.group.key === groupKey);
    return group.sections.find(section => section.title === title).entries;
  };
  const keys = (groupKey, title) => Array.from(sectionEntries(groupKey, title), entry => entry.key);
  assert.deepEqual(keys("providers-local", "Zipformer ASR"), [
    "ZIPFORMER_MODEL_DIR", "ZIPFORMER_PYTHON_PATH", "ZIPFORMER_THREADS",
  ]);
  assert.deepEqual(keys("ai-features", "Auto Listening").slice(0, 2), [
    "AUTO_LISTENING_ENABLED", "AUTO_LISTENING_END_KEYWORDS",
  ]);
  const endKeywords = sectionEntries("ai-features", "Auto Listening")[1];
  assert.equal(endKeywords.commented, false);
  assert.equal(endKeywords.defaultValue, "byebye,goodbye,bye for now,stop,all done,end conversation");
  assert.ok(!keys("ai-features", "Auto Listening").includes("WAKE_WORD_END_KEYWORDS"));
  assert.ok(keys("ai-features", "Wake word").includes("WAKE_WORD_END_KEYWORDS"));
  assert.ok(sectionEntries("core", "Core").find(entry => entry.key === "ASR_SERVER").options.includes("zipformer"));
});

test("saving Auto Listening changes only its env key and keeps the env file private", t => {
  const { saveAutoListening, isAutoListeningEnabled } = require("../../dist/config/auto-listening");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "auto-listening-settings-"));
  const envPath = path.join(dir, ".env");
  const key = "AUTO_LISTENING_ENABLED";
  const original = process.env[key];
  t.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  });
  const contents = "# AUTO_LISTENING_ENABLED=false\nAUTO_LISTENING_END_KEYWORDS=GoOdByE\nWAKE_WORD_END_KEYWORDS=EXIT\n";
  fs.writeFileSync(envPath, contents, { mode: 0o600 });
  saveAutoListening(true, envPath);
  assert.equal(isAutoListeningEnabled(), true);
  assert.equal(fs.readFileSync(envPath, "utf8"), contents + "AUTO_LISTENING_ENABLED=true\n");
  saveAutoListening(false, envPath);
  assert.equal(isAutoListeningEnabled(), false);
  assert.equal(fs.readFileSync(envPath, "utf8"), contents + "AUTO_LISTENING_ENABLED=false\n");
  assert.equal(fs.statSync(envPath).mode & 0o777, 0o600);
});

function loadChatFlow(env) {
  let configure;
  const exports = {};
  const flowPath = path.join(__dirname, "../../dist/core/ChatFlow.js");
  vm.runInNewContext(fs.readFileSync(flowPath, "utf8"), {
    exports, process: { env },
    Date, console: { log() {} },
    require(id) {
      if (id === "./../utils/index") return { getCurrentTimeTag: () => "" };
      if (id === "../device/display") return { display() {}, onAutoListeningChange: callback => { configure = callback; } };
      if (id === "../config/auto-listening") return { isAutoListeningEnabled: () => false };
      if (id === "./chat-flow/stateMachine") {
        return { FlowStateMachine: class {
          constructor(ctx) { this.ctx = ctx; }
          transitionTo(flow) { this.ctx.currentFlowName = flow; }
        } };
      }
      if (id === "./StreamResponsor") return { StreamResponser: class {} };
      if (id === "dotenv") return { config() {} };
      if (id === "../device/music-player") return { isMusicPlaying: () => false };
      return {};
    },
  });
  const flow = new exports.default();
  return { flow, configure };
}

test("the Settings callback changes the live mode and each session uses its own end phrases", () => {
  const { flow, configure } = loadChatFlow({
    AUTO_LISTENING_END_KEYWORDS: " GoodBye , ALL DONE , Bye-Bye ",
    WAKE_WORD_END_KEYWORDS: " Exit ",
  });
  configure(true);
  assert.equal(flow.autoListeningEnabled, true);
  flow.startWakeSession(true);
  assert.equal(flow.currentFlowName, "wake_listening");
  assert.equal(flow.shouldEndAutoListening("GOOD BYE."), true);
  assert.equal(flow.shouldEndAutoListening("BYE BYE."), true);
  assert.equal(flow.shouldEndAutoListening("all done"), true);
  assert.equal(flow.shouldEndAutoListening("EXIT"), false);
  assert.equal(flow.shouldEndAfterAnswer("EXIT"), false);
  configure(false);
  assert.equal(flow.currentFlowName, "sleep");
  assert.equal(flow.wakeSessionActive, false);
  configure(true);
  flow.startWakeSession();
  assert.equal(flow.shouldEndAutoListening("GOODBYE."), false);
  assert.equal(flow.shouldEndAfterAnswer("GOODBYE."), false);
  assert.equal(flow.shouldEndAfterAnswer("EXIT"), true);
});

test("the Auto Listening list uses its own defaults and accepts an explicit empty list", () => {
  for (const value of [undefined, ""]) {
    const { flow, configure } = loadChatFlow({
      AUTO_LISTENING_END_KEYWORDS: value,
      WAKE_WORD_END_KEYWORDS: "QUIT",
    });
    configure(true);
    flow.startWakeSession(true);
    for (const phrase of ["BYE BYE", "GOOD BYE", "BYE FOR NOW", "STOP", "ALL DONE", "END CONVERSATION"]) {
      assert.equal(flow.shouldEndAutoListening(phrase), value === undefined, phrase);
    }
    assert.equal(flow.shouldEndAutoListening("QUIT"), false);
  }
});

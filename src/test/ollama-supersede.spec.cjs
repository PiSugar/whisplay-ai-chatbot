const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const { test } = require("node:test");
const vm = require("node:vm");
const dist = path.join(__dirname, "../../dist/cloud-api/local");

function load(dir, post, funcs = {}) {
  const source = fs.readFileSync(path.join(dist, "ollama-llm.js"), "utf8");
  const exports = {};
  vm.runInNewContext(source, {
    exports, Buffer, console: { log() {}, warn() {}, error() {} }, process: { env: { OLLAMA_ENABLE_TOOLS: "true" } },
    setTimeout, clearTimeout, AbortController,
    require(id) {
      switch (id) {
        case "axios": return { post };
        case "dotenv": return { config() {} };
        case "lodash": return { isEmpty: x => !x.length };
        case "moment": return () => ({ format: () => "fixture" });
        case "../../config/llm-config": return { systemPrompt: "fixture", shouldResetChatHistory: () => false, updateLastMessageTime() {} };
        case "../../config/llm-tools": return { llmTools: [], llmFuncMap: funcs };
        case "../../type": return { ToolReturnTag: { Response: "[response]" } };
        case "../../utils/dir": return { chatHistoryDir: dir };
        case "../../config/common": return { extractToolResponse: () => "" };
        case "./common": return { defaultPortMap: { ollama: 11434 } };
        case "../../utils/image": return {};
        case "../context-window": return { compactMessagesForContextWindow: async () => {} };
        case "./ollama-ndjson": return require(path.join(dist, id));
        default: return require(id);
      }
    },
  });
  return exports.default;
}

const line = record => Buffer.from(JSON.stringify(record) + "\n");
// A reply that streams its first part at once and the rest after `ms`, unless the request is aborted first.
const slowReply = (signal, first, rest, ms = 300) => Readable.from((async function* () {
  yield line({ message: first });
  await new Promise(resolve => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
  });
  if (signal?.aborted) throw Object.assign(new Error("canceled"), { code: "ERR_CANCELED" });
  yield line({ message: rest, done: true });
})());
const quickReply = content => Readable.from([line({ message: { content }, done: true })]);
const wire = body => JSON.parse(JSON.stringify(body.messages)).map(({ role, content }) => `${role}:${content}`);

function ask(llm, content) {
  const result = { text: "", ends: 0 };
  result.done = llm.chatWithLLMStream([{ role: "user", content }], chunk => { result.text += chunk; }, () => result.ends++);
  return result;
}

test("a new question cancels the unfinished answer and removes it from the history", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ollama-supersede-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const requests = [];
  let firstSeen;
  const firstRequest = new Promise(resolve => { firstSeen = resolve; });
  const llm = load(dir, async (url, body, config = {}) => {
    requests.push({ body, signal: config.signal });
    if (requests.length === 1) {
      firstSeen();
      return { data: slowReply(config.signal, { content: "Old " }, { content: "answer." }) };
    }
    return { data: quickReply(`Answer ${requests.length}.`) };
  });

  const first = ask(llm, "First question");
  await firstRequest;
  const second = ask(llm, "Second question");
  await Promise.all([first.done, second.done]);

  assert.equal(requests[0].signal?.aborted, true, "the superseded request is aborted");
  assert.deepEqual(wire(requests[1].body), ["system:fixture", "user:Second question"]);
  assert.equal(first.text, "Old ");
  assert.equal(first.ends, 1);
  assert.equal(second.text, "Answer 2.");
  assert.equal(second.ends, 1);

  await ask(llm, "Third question").done;
  assert.deepEqual(wire(requests[2].body), ["system:fixture", "user:Second question", "assistant:Answer 2.", "user:Third question"]);
});

test("a cancelled answer does not add its tool results to the newer question's history", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ollama-supersede-tool-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const requests = [];
  let toolStarted, finishTool;
  const toolRunning = new Promise(resolve => { toolStarted = resolve; });
  const toolGate = new Promise(resolve => { finishTool = resolve; });
  const call = { function: { index: 0, name: "fixture", arguments: {} } };
  const llm = load(dir, async (url, body, config = {}) => {
    requests.push({ body, signal: config.signal });
    if (requests.length === 1) return { data: Readable.from([line({ message: { tool_calls: [call] }, done: true })]) };
    return { data: quickReply(`Answer ${requests.length}.`) };
  }, { async fixture() { toolStarted(); await toolGate; return "late result"; } });

  const first = ask(llm, "Use the tool");
  await toolRunning;
  const second = ask(llm, "Never mind");
  await second.done;
  finishTool();
  await first.done;

  assert.equal(requests.length, 2, "the cancelled answer sends no follow-up request");
  assert.deepEqual(wire(requests[1].body), ["system:fixture", "user:Never mind"]);
  assert.equal(first.ends, 1);
  await ask(llm, "Next").done;
  assert.deepEqual(wire(requests[2].body), ["system:fixture", "user:Never mind", "assistant:Answer 2.", "user:Next"]);
});

test("answers that do not overlap keep the whole history", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ollama-supersede-seq-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const requests = [];
  const llm = load(dir, async (url, body, config = {}) => {
    requests.push({ body, signal: config.signal });
    return { data: quickReply(`Answer ${requests.length}.`) };
  });
  await ask(llm, "One").done;
  await ask(llm, "Two").done;
  assert.equal(requests[0].signal?.aborted ?? false, false);
  assert.deepEqual(wire(requests[1].body), ["system:fixture", "user:One", "assistant:Answer 1.", "user:Two"]);
});

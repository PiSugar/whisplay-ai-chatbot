const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const dist = path.join(__dirname, "../../dist/cloud-api/local");

// Loads the module with LLM_SERVER=ollama, so it sends its warm-up request at once. Timers run
// through a queue the test drains, so retries happen without waiting.
function load(outcomes) {
  const source = fs.readFileSync(path.join(dist, "ollama-llm.js"), "utf8");
  const posts = [], delays = [], timers = [];
  vm.runInNewContext(source, {
    exports: {}, Buffer, AbortController, console: { log() {}, warn() {}, error() {} },
    process: { env: { LLM_SERVER: "ollama" } },
    setTimeout(fn, ms) { delays.push(ms); timers.push(fn); return { unref() {} }; },
    require(id) {
      switch (id) {
        case "axios": return { async post(url, body) {
          posts.push(body);
          const outcome = outcomes.shift();
          if (outcome instanceof Error) throw outcome;
          return { data: { done_reason: "load" } };
        } };
        case "dotenv": return { config() {} };
        case "lodash": return { isEmpty: x => !x.length };
        case "moment": return () => ({ format: () => "fixture" });
        case "../../config/llm-config": return { systemPrompt: "fixture", shouldResetChatHistory: () => false, updateLastMessageTime() {} };
        case "../../config/llm-tools": return { llmTools: [], llmFuncMap: {} };
        case "../../type": return { ToolReturnTag: { Response: "[response]" } };
        case "../../utils/dir": return { chatHistoryDir: "." };
        case "../../config/common": return { extractToolResponse: () => "" };
        case "./common": return { defaultPortMap: { ollama: 11434 } };
        case "../../utils/image": return {};
        case "../context-window": return { compactMessagesForContextWindow: async () => {} };
        case "./ollama-ndjson": return require(path.join(dist, id));
        default: return require(id);
      }
    },
  });
  const settle = () => new Promise(resolve => setImmediate(resolve));
  return {
    posts, delays,
    async drain() {
      await settle();
      while (timers.length) { timers.shift()(); await settle(); }
    },
  };
}

test("a failed warm-up load is retried until it succeeds", async () => {
  const run = load([Error("connect ECONNREFUSED"), Error("Request failed with status code 500")]);
  await run.drain();
  assert.equal(run.posts.length, 3);
  assert.deepEqual(run.delays, [10000, 10000]);
  assert.ok(run.posts.every(body => JSON.stringify(body) === JSON.stringify(run.posts[0])), "every attempt sends the same request");
});

test("the warm-up gives up after four failed attempts", async () => {
  const failure = Error("connect ECONNREFUSED");
  const run = load([failure, failure, failure, failure, failure]);
  await run.drain();
  assert.equal(run.posts.length, 4);
  assert.equal(run.delays.length, 3);
});

test("a successful warm-up sends one request", async () => {
  const run = load([]);
  await run.drain();
  assert.equal(run.posts.length, 1);
  assert.deepEqual(run.delays, []);
});

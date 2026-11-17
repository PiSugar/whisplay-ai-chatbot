const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const { test } = require("node:test");
const vm = require("node:vm");
const dist = path.join(__dirname, "../../dist/cloud-api/local");

test("Ollama preserves split UTF-8 and tool history and dispatches only completed calls", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ollama-stream-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = fs.readFileSync(path.join(dist, "ollama-llm.js"), "utf8");
  const call = { id: "native-id", function: { index: 0, name: "fixture", arguments: { n: 1 } } };
  const record = message => ({ message });
  const tool = record({ tool_calls: [call] });
  const done = { done: true };
  let executions = 0;
  const requests = [];
  const responses = [
    [record({ content: "Hei 🌍" }), JSON.stringify({ ...tool, done: true })],
    [JSON.stringify({ ...record({ content: "Finished." }), done: true })],
    [tool, tool, done],
    [JSON.stringify({ ...record({ content: "Already handled." }), done: true })],
    [tool],
    [tool, done, '{'],
    [tool, { error: "fixture failure" }],
    [tool, Error("disconnected")],
    [JSON.stringify(tool)],
    [tool, done, Error("disconnected before clean EOF")],
  ];
  const exports = {};
  vm.runInNewContext(source, {
    exports, Buffer, console, process: { env: { OLLAMA_ENABLE_TOOLS: "true" } },
    require(id) {
      switch (id) {
        case "axios": return { async post(url, body) {
          requests.push(body);
          const records = responses.shift();
          return { data: Readable.from((async function* () {
            for (const record of records) {
              if (record instanceof Error) throw record;
              const bytes = Buffer.from(typeof record === "string" ? record : JSON.stringify(record) + "\r\n");
              for (const byte of bytes) yield Buffer.from([byte]);
            }
          })()) };
        } };
        case "dotenv": return { config() {} };
        case "lodash": return { isEmpty: x => !x.length };
        case "moment": return () => ({ format: () => "fixture" });
        case "../../config/llm-config": return { systemPrompt: "fixture", shouldResetChatHistory: () => false, updateLastMessageTime() {} };
        case "../../config/llm-tools": return { llmTools: [], llmFuncMap: { async fixture() { executions++; return "result"; } } };
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
  async function ask() {
    let text = "", ends = 0;
    await exports.default.chatWithLLMStream([{ role: "user", content: "test" }], chunk => { text += chunk; }, () => ends++);
    assert.equal(ends, 1);
    return text;
  }
  assert.equal(await ask(), "Hei 🌍Finished.");
  assert.equal(executions, 1);
  const wire = JSON.parse(JSON.stringify(requests[1].messages));
  assert.deepEqual(wire.slice(-2), [
    { role: "assistant", content: "Hei 🌍", tool_calls: [call] },
    { role: "tool", content: "result", tool_name: "fixture", tool_call_id: "native-id" },
  ]);
  // [A, A] in one response is one call: it runs once, then the follow-up answers.
  assert.equal(await ask(), "Already handled.");
  assert.equal(executions, 2);
  for (let i = 0; i < 6; i++) assert.equal(await ask(), "");
  assert.equal(executions, 2);
  assert.equal(responses.length, 0);
});

// Duplicate tool calls: identical calls inside one response run once, a call already executed earlier in
// the same top-level request stays blocked, and a blocked answer never uses results from earlier turns.
function duplicateHarness(responses) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ollama-dup-test-"));
  const source = fs.readFileSync(path.join(dist, "ollama-llm.js"), "utf8");
  const requests = [];
  const runs = [];
  const exports = {};
  const handler = name => async args => { runs.push(name); return `result-${name}-${runs.length}`; };
  vm.runInNewContext(source, {
    exports, Buffer, console: { ...console, warn() {}, log() {} }, process: { env: { OLLAMA_ENABLE_TOOLS: "true" } },
    require(id) {
      switch (id) {
        case "axios": return { async post(url, body) {
          requests.push(JSON.parse(JSON.stringify(body)));
          const records = responses.shift();
          return { data: Readable.from(records.map(record => Buffer.from(JSON.stringify(record) + "\n"))) };
        } };
        case "dotenv": return { config() {} };
        case "lodash": return { isEmpty: x => !x.length };
        case "moment": return () => ({ format: () => "fixture" });
        case "../../config/llm-config": return { systemPrompt: "fixture", shouldResetChatHistory: () => false, updateLastMessageTime() {} };
        case "../../config/llm-tools": return { llmTools: [], llmFuncMap: { A: handler("A"), B: handler("B") } };
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
  const ask = async content => {
    let text = "";
    await exports.default.chatWithLLMStream([{ role: "user", content }], chunk => { text += chunk; }, () => {});
    return text;
  };
  return { ask, runs, requests, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
const callA = { id: "id-a", function: { name: "A", arguments: { n: 1 } } };
const callB = { id: "id-b", function: { name: "B", arguments: { n: 2 } } };
const calls = (...c) => ({ message: { tool_calls: c }, done: true });
const answer = content => ({ message: { content }, done: true });

test("[A, A] in one response executes A exactly once", async t => {
  for (const response of [[calls(callA, callA)], [{ message: { tool_calls: [callA] } }, calls(callA)]]) {
    const h = duplicateHarness([response, [answer("Done.")]]);
    t.after(h.cleanup);
    assert.equal(await h.ask("go"), "Done.");
    assert.deepEqual(h.runs, ["A"]);
    const wire = h.requests[1].messages.slice(-2);
    assert.deepEqual(wire[0].tool_calls, [callA], "history records the one executed call");
    assert.deepEqual(wire[1], { role: "tool", content: "result-A-1", tool_name: "A", tool_call_id: "id-a" });
  }
});

test("[A, B, B] executes A and B once each, keeping order and history", async t => {
  const h = duplicateHarness([[calls(callA, callB, callB)], [answer("Done.")]]);
  t.after(h.cleanup);
  assert.equal(await h.ask("go"), "Done.");
  assert.deepEqual(h.runs, ["A", "B"]);
  const wire = h.requests[1].messages.slice(-3);
  assert.deepEqual(wire[0].tool_calls, [callA, callB]);
  assert.deepEqual(wire.slice(1).map(m => [m.tool_name, m.tool_call_id]), [["A", "id-a"], ["B", "id-b"]]);
});

test("a call already executed earlier in the same request stays blocked and uses this request's result", async t => {
  const h = duplicateHarness([[calls(callA)], [calls(callA)], [answer("Final.")]]);
  t.after(h.cleanup);
  assert.equal(await h.ask("go"), "Final.");
  assert.deepEqual(h.runs, ["A"], "the repeat in round two is not executed");
  assert.match(JSON.stringify(h.requests[2].messages), /Available A result:\\nresult-A-1/);
});

test("results from earlier conversation turns are never reused, and a new turn may run the same call", async t => {
  const h = duplicateHarness([[calls(callA)], [answer("Turn one.")], [calls(callA, callA)], [calls(callA)], [answer("Turn two.")]]);
  t.after(h.cleanup);
  assert.equal(await h.ask("first"), "Turn one.");
  assert.equal(await h.ask("second"), "Turn two.");
  assert.deepEqual(h.runs, ["A", "A"], "turn two runs A once despite the same call in turn one");
  const blocked = JSON.stringify(h.requests[4].messages);
  assert.match(blocked, /Available A result:\\nresult-A-2/);
  assert.doesNotMatch(blocked, /Available A result:\\nresult-A-1/);
});

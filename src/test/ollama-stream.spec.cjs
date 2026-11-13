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
  assert.equal(await ask(), "Already handled.");
  for (let i = 0; i < 6; i++) assert.equal(await ask(), "");
  assert.equal(executions, 1);
  assert.equal(responses.length, 0);
});

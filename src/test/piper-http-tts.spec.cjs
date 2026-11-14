const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../../dist/cloud-api/local/piper-http-tts.js"), "utf8");

test("Piper preserves defaults, sends valid JSON, validates responses and cleans up", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "piper-http-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let status = "200", audio = "RIFF0000WAVE", failConversion = false, failRequest = false;
  const calls = [];
  const logs = [];
  const marker = "private speech and request arguments";
  function load(env) {
    const exports = {};
    const capture = (...args) => logs.push(args.join(" "));
    vm.runInNewContext(source, { exports, Buffer, process: { env, pid: 1, on() {} },
      console: { log: capture, warn: capture, error: capture }, require(id) {
      if (id === "dotenv") return { config() {} };
      if (id === "../../type") return { TTSServer: { piperhttp: "piper-http" } };
      if (id === "../../utils/dir") return { ttsDir: dir };
      if (id === "./common") return { defaultPortMap: { piperHttp: 8805 } };
      if (id === "get-audio-duration") return { getAudioDurationInSeconds: async () => 0.5 };
      if (id === "node:util") return { promisify: fn => (...args) =>
        new Promise((resolve, reject) => fn(...args, (error, stdout) =>
          error ? reject(error) : resolve({ stdout }))) };
      if (id === "child_process") return { execFile(command, args, cb) {
        calls.push([command, args]);
        if (command === "curl") {
          fs.writeFileSync(args[args.indexOf("-o") + 1], audio);
          cb(failRequest ? Error(marker) : null, status, marker);
        } else {
          fs.writeFileSync(args.at(-1), audio);
          cb(failConversion ? Error(marker) : null, "", marker);
        }
      } };
      return require(id);
    } });
    return exports.default;
  }
  const input = 'Quotes " and \\ plus\na newline';
  const defaults = load({});
  const [first, second] = await Promise.all([defaults(input), defaults(input)]);
  assert.equal(first.duration, 500);
  assert.notEqual(first.filePath, second.filePath);
  assert.equal(fs.readdirSync(dir).length, 2);
  for (const result of [first, second]) fs.unlinkSync(result.filePath);
  const curl = calls.find(([command]) => command === "curl")[1];
  assert.equal(curl.at(-1), "http://localhost:8805");
  assert.equal(curl[curl.indexOf("--max-time") + 1], "60");
  assert.deepEqual(JSON.parse(curl[curl.indexOf("--data-binary") + 1]), { text: input, length_scale: 1 });

  const custom = load({ PIPER_HTTP_PATH: "synthesize", PIPER_HTTP_VOICE: "example", PIPER_HTTP_TIMEOUT_SEC: "2" });
  for (const [code, body, badSoX] of [["500", audio, false], ["200", "<html>", false], ["200", audio, true]]) {
    status = code;
    audio = body;
    failConversion = badSoX;
    const offset = calls.length;
    assert.equal((await custom(input)).duration, 0);
    const request = calls[offset][1];
    assert.equal(request.at(-1), "http://localhost:8805/synthesize");
    assert.equal(request[request.indexOf("--max-time") + 1], "2");
    assert.equal(JSON.parse(request[request.indexOf("--data-binary") + 1]).voice, "example");
    assert.equal(calls.length - offset, badSoX ? 2 : 1);
    assert.deepEqual(fs.readdirSync(dir), []);
  }
  failRequest = true;
  const offset = calls.length;
  assert.equal((await custom(input)).duration, 0);
  assert.equal(calls.length - offset, 1);
  assert.deepEqual(fs.readdirSync(dir), []);
  status = marker;
  failRequest = false;
  assert.equal((await custom(marker)).duration, 0);
  assert.ok(logs.some(line => line.includes("HTTP status 500")));
  assert.ok(logs.some(line => line.includes("SoX conversion")));
  assert.ok(logs.every(line => !line.includes(marker) && !line.includes(input)));
});

const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { createServer } = require("node:net");
const { once } = require("node:events");
const { createInterface } = require("node:readline");
const { join } = require("node:path");
const { test } = require("node:test");
const {
  openZipformerStream,
  recognizeZipformerFile,
} = require("../../dist/cloud-api/local/zipformer-asr");

async function serverFixture(t, onMessage) {
  const directory = mkdtempSync("/tmp/whisplay-test-asr-");
  const path = join(directory, "asr.sock");
  const sockets = new Set();
  const server = createServer(socket => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    const lines = createInterface({ input: socket });
    lines.on("line", line => onMessage(JSON.parse(line), socket));
  });
  server.listen(path);
  await once(server, "listening");
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  });
  return path;
}

const send = (socket, id, type, text) =>
  socket.write(JSON.stringify({ id, type, text }) + "\n");

test("file ASR uses a separate request and distinguishes empty speech from a failed request", async t => {
  const requests = [];
  const path = await serverFixture(t, (message, socket) => {
    requests.push(message);
    if (message.path === "/recordings/a b.wav") {
      send(socket, "wrong-id", "final", "stale");
      send(socket, message.id, "final", "Recognized.");
    } else if (message.path === "/recordings/silence.wav") {
      send(socket, message.id, "final", "");
    } else {
      send(socket, message.id, "error");
    }
  });
  assert.equal(await recognizeZipformerFile(path, "/recordings/a b.wav"), "Recognized.");
  assert.equal(await recognizeZipformerFile(path, "/recordings/silence.wav"), "");
  assert.equal(await recognizeZipformerFile(path, "/recordings/missing.wav"), undefined);
  assert.deepEqual(requests.map(message => message.type), ["file", "file", "file"]);
});

test("stream shows revised previews and submits one final after the last captured frame", async t => {
  const messages = [];
  let onPreviews;
  const previewed = new Promise(resolve => { onPreviews = resolve; });
  const subtitles = [];
  const path = await serverFixture(t, (message, socket) => {
    messages.push(message);
    if (message.type === "audio" && messages.filter(item => item.type === "audio").length === 1) {
      send(socket, message.id, "partial", "Old words");
      send(socket, "wrong-session", "partial", "wrong");
      send(socket, message.id, "partial", "New words");
    }
    if (message.type === "finish") {
      send(socket, message.id, "partial", "late preview");
      send(socket, message.id, "final", "New words.");
      send(socket, message.id, "final", "duplicate");
    }
  });
  const stream = openZipformerStream(path, text => {
    subtitles.push(text);
    if (subtitles.length === 2) onPreviews();
  });
  stream.write(Buffer.from([1, 2, 3]));
  await previewed;
  stream.write(Buffer.from([4]));
  assert.equal(await stream.finish(), "New words.");
  assert.deepEqual(subtitles, ["Old words", "New words"]);
  assert.deepEqual(messages.map(item => item.type), ["start", "audio", "audio", "finish"]);
  assert.equal(messages[0].endpoint, undefined);
  assert.deepEqual(Buffer.concat(messages.filter(item => item.pcm).map(item => Buffer.from(item.pcm, "base64"))),
    Buffer.from([1, 2, 3, 4]));
});

test("native endpoints are opt-in and request a stop without settling the final", async t => {
  const path = await serverFixture(t, (message, socket) => {
    if (message.type === "start" && message.endpoint === true) {
      send(socket, "wrong-id", "endpoint");
      send(socket, message.id, "endpoint");
    }
    if (message.type === "finish") {
      send(socket, message.id, "endpoint");
      send(socket, message.id, "final", "Finished.");
    }
  });
  let requestStop;
  const stopped = new Promise(resolve => { requestStop = resolve; });
  let stopCount = 0;
  const stream = openZipformerStream(path, () => {}, undefined, () => {
    stopCount++;
    requestStop();
  });
  await stopped;
  assert.equal(stopCount, 1);
  assert.equal(await stream.finish(), "Finished.");
  assert.equal(stopCount, 1);
});

test("a timed-out Zipformer stream cancels and ignores a late final", async t => {
  let cancellation;
  const cancelled = new Promise(resolve => { cancellation = resolve; });
  const path = await serverFixture(t, (message, socket) => {
    if (message.type === "cancel") {
      cancellation();
      send(socket, message.id, "final", "late");
    }
  });
  const stream = openZipformerStream(path, () => assert.fail("unexpected subtitle"));
  assert.equal(await stream.finish(25), undefined);
  await cancelled;
});

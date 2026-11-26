const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { test } = require("node:test");
const axios = require("axios");

process.env.IMAGE_GENERATION_SERVER = "minimax";
process.env.MINIMAX_API_KEY = "test-key";
delete process.env.MINIMAX_IMAGE_MODEL;
delete process.env.MINIMAX_IMAGE_REGION;

const { addImageGenerationTools } = require("../dist/config/image-generation");
const { getLatestGenImg } = require("../dist/utils/image");
const tools = [];
addImageGenerationTools(tools);
const generate = tools.find((tool) => tool.function.name === "generateImage").func;

test("generateImage saves the H3 image and selects the configured region and model", async (t) => {
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const post = t.mock.method(axios, "post", async () => ({
    data: { data: [{ b64_json: bytes.toString("base64") }] },
  }));
  for (const [region, model, host] of [
    ["", "", "api.minimax.io"],
    ["cn", "MiniMax-H3-Image-Highspeed", "api.minimax.cn"],
  ]) {
    process.env.MINIMAX_IMAGE_REGION = region;
    process.env.MINIMAX_IMAGE_MODEL = model;
    const result = await generate({ prompt: "A red kite" });
    assert.equal(result, "[success]Image file saved.");
    const [url, payload, config] = post.mock.calls.at(-1).arguments;
    assert.equal(url, `https://${host}/v1/images/generations`);
    assert.deepEqual(payload, {
      model: model || "MiniMax-H3-Image",
      prompt: "A red kite",
      n: 1,
      response_format: "b64_json",
      output_format: "jpeg",
    });
    assert.equal(config.headers.Authorization, "Bearer test-key");
    assert.ok(config.timeout >= 600_000);
    assert.equal(config.maxRedirects, 0);
    const file = getLatestGenImg();
    t.after(() => fs.unlink(file));
    assert.match(file, /\.jpg$/);
    assert.deepEqual(await fs.readFile(file), bytes);
  }
  assert.equal(post.mock.callCount(), 2);
});

test("generateImage returns API and per-image failures without resubmitting", async (t) => {
  const latest = getLatestGenImg();
  const post = t.mock.method(axios, "post", async () => ({
    data: { data: [{ error: { code: "1027", message: "Image withheld" } }] },
  }));
  assert.match(await generate({ prompt: "A kite" }), /^\[error\].*Image withheld/);

  post.mock.mockImplementation(async () => {
    throw new axios.AxiosError("Payment Required", "ERR_BAD_REQUEST", {}, null, {
      status: 402,
      data: { type: "error", error: { type: "insufficient_balance_error", message: "Insufficient balance" } },
    });
  });
  assert.match(await generate({ prompt: "A kite" }), /^\[error\].*Insufficient balance/);
  assert.match(await generate({ prompt: "Edit it", withImageContext: true }), /^\[error\]/);
  assert.equal(post.mock.callCount(), 2);
  assert.equal(getLatestGenImg(), latest);
});

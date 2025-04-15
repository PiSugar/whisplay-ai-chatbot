const axios = require("axios");
const WebSocket = require("ws");
const zlib = require("zlib");
const { v4: uuidv4 } = require("uuid");
require("dotenv").config();

// ByteDance TTS
const byteDanceAppId = process.env.BYTE_DANCE_APP_ID;
const byteDanceAccessToken = process.env.BYTE_DANCE_ACCESS_TOKEN;

const host = "openspeech.bytedance.com";
const api_url = `wss://${host}/api/v1/tts/ws_binary`;
const default_header = Buffer.from([0x11, 0x10, 0x11, 0x00]);
const audio_config = {
  voice_type: "zh_female_wanwanxiaohe_moon_bigtts",
  rate: 16000,
  speed_ratio: 1.0,
  pitch_ratio: 1.0,
  volume_ratio: 2.0,
  encoding: "mp3",
};

const client = new WebSocket(api_url, {
  headers: { Authorization: `Bearer; ${accessToken}` },
  perMessageDeflate: false,
});

let cb = () => {};

client.on("open", () => {
  console.log("TTS WebSocket connection opened");
});

client.on("message", (res, err) => {
  if (err) {
    console.log("tts message error: " + err);
    return;
  }
  // const protocol_version = res[0] >> 4;
  const header_size = res[0] & 0x0f;
  const message_type = res[1] >> 4;
  const message_type_specific_flags = res[1] & 0x0f;
  // const serialization_method = res[2] >> 4;
  const message_compression = res[2] & 0x0f;
  let payload = res.slice(header_size * 4);
  let done = false;
  if (message_type === 0xb) {
    // audio-only server response
    if (message_type_specific_flags === 0) {
      // no sequence number as ACK
      return false;
    } else {
      const sequence_number = payload.readInt32BE(0);
      payload = payload.slice(8);

      done = sequence_number < 0;
    }
  } else if (message_type === 0xf) {
    const code = payload.readUInt32BE(0);
    const msg_size = payload.readUInt32BE(4);
    let error_msg = payload.slice(8);
    if (message_compression === 1) {
      error_msg = zlib.gunzipSync(error_msg);
    }
    error_msg = error_msg.toString("utf-8");
    console.log(`Error message code: ${code}`);
    console.log(`Error message size: ${msg_size} bytes`);
    console.log(`Error message: ${error_msg}`);
    client.close();
    cb({ data: '', duration: 0 });
    return;
  } else if (message_type === 0xc) {
    payload = payload.slice(4);
    if (message_compression === 1) {
      payload = zlib.gunzipSync(payload);
    }
    console.log(`Frontend message: ${payload}`);
  } else {
    console.log("undefined message type!");
    done = true;
  }
  cb({ data: payload, duration: 200 });
});

client.on("error", (err) => {
  console.log("volcengine tts error: " + err);
});

client.on("close", () => {
  console.log("TTS WebSocket connection closed");
});

function synthesizeSpeech(text) {
  const request_json = {
    app: {
      appid: byteDanceAppId,
      token: byteDanceAccessToken,
      cluster: "volcano_tts",
    },
    user: {
      uid: device_id,
    },
    audio: audio_config,
    request: {
      reqid: uuidv4(),
      text: text,
      text_type: "plain",
      operation: "submit",
    },
  };

  const submit_request_json = JSON.parse(JSON.stringify(request_json));
  let payload_bytes = Buffer.from(JSON.stringify(submit_request_json));
  payload_bytes = zlib.gzipSync(payload_bytes); // if no compression, comment this line
  const full_client_request = Buffer.concat([
    default_header,
    Buffer.alloc(4),
    payload_bytes,
  ]);
  full_client_request.writeUInt32BE(payload_bytes.length, 4);

  client && client.send(full_client_request);
  return new Promise((resolve) => {
    cb = resolve;
  });
}

module.exports = synthesizeSpeech;

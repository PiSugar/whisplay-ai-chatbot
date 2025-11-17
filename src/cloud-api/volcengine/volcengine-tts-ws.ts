import axios from "axios";
import WebSocket from "ws";
import zlib from "zlib";
import { v4 as uuidv4 } from "uuid";
import dotenv from "dotenv";

dotenv.config();

// ByteDance TTS
const byteDanceAppId = process.env.VOLCENGINE_APP_ID || "";
const byteDanceAccessToken = process.env.VOLCENGINE_ACCESS_TOKEN || "";
const byteDanceVoiceType = process.env.VOLCENGINE_VOICE_TYPE || "zh_female_wanwanxiaohe_moon_bigtts";

const host = "openspeech.bytedance.com";
const api_url = `wss://${host}/api/v1/tts/ws_binary`;
const default_header = Buffer.from([0x11, 0x10, 0x11, 0x00]);

const audio_config = {
  voice_type: byteDanceVoiceType,
  rate: 16000,
  speed_ratio: 1.0,
  pitch_ratio: 1.0,
  volume_ratio: 2.0,
  encoding: "mp3",
};

interface SynthesizeResponse {
  data: Buffer | string;
  duration: number;
}

let cb: (response: SynthesizeResponse) => void = () => {};

const client = new WebSocket(api_url, {
  headers: { Authorization: `Bearer ${byteDanceAccessToken}` },
  perMessageDeflate: false,
});

client.on("open", () => {
  console.log("TTS WebSocket connection opened");
});

client.on("message", (data: WebSocket.Data) => {
  if (!(data instanceof Buffer)) {
    console.error("Unexpected data type received");
    return;
  }

  const header_size = data[0] & 0x0f;
  const message_type = data[1] >> 4;
  const message_type_specific_flags = data[1] & 0x0f;
  const message_compression = data[2] & 0x0f;
  let payload = data.slice(header_size * 4);
  let done = false;

  if (message_type === 0xb) {
    if (message_type_specific_flags === 0) {
      return;
    } else {
      const sequence_number = payload.readInt32BE(0);
      payload = payload.slice(8);
      done = sequence_number < 0;
    }
  } else if (message_type === 0xf) {
    const code = payload.readUInt32BE(0);
    const msg_size = payload.readUInt32BE(4);
    let error_msg: any = payload.slice(8);
    if (message_compression === 1) {
      error_msg = zlib.gunzipSync(error_msg);
    }
    error_msg = error_msg.toString("utf-8");
    console.error(`Error message code: ${code}`);
    console.error(`Error message size: ${msg_size} bytes`);
    console.error(`Error message: ${error_msg}`);
    client.close();
    cb({ data: "", duration: 0 });
    return;
  } else if (message_type === 0xc) {
    payload = payload.slice(4);
    if (message_compression === 1) {
      payload = zlib.gunzipSync(payload);
    }
    console.log(`Frontend message: ${payload}`);
  } else {
    console.error("Undefined message type!");
    done = true;
  }

  cb({ data: payload, duration: 200 });
});

client.on("error", (err: Error) => {
  console.error("volcengine tts error: " + err.message);
});

client.on("close", () => {
  console.log("TTS WebSocket connection closed");
});

function synthesizeSpeech(text: string): Promise<SynthesizeResponse> {
  const device_id = "default_device_id"; // Replace with actual device ID if needed

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
  payload_bytes = zlib.gzipSync(payload_bytes); // If no compression, comment this line
  const full_client_request = Buffer.concat([
    default_header,
    Buffer.alloc(4),
    payload_bytes,
  ]);
  full_client_request.writeUInt32BE(payload_bytes.length, 4);

  client.send(full_client_request);

  return new Promise((resolve) => {
    cb = resolve;
  });
}

export default synthesizeSpeech;

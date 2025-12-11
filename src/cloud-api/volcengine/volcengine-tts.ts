import axios from "axios";
import { v4 as uuidv4 } from "uuid";
import dotenv from "dotenv";
import {
  byteDanceAccessToken,
  byteDanceAppId,
  byteDanceVoiceType,
} from "./volcengine";
import { TTSResult } from "../../type";

dotenv.config();

interface Payload {
  app: {
    appid: string;
    token: string;
    cluster: string;
  };
  user: {
    uid: string;
  };
  audio: {
    voice_type: string;
    encoding: string;
    speed_ratio: number;
    volume_ratio: number;
  };
  request: {
    reqid: string;
    text: string;
    operation: string;
  };
}

const volcengineTTS = async (
  text: string
): Promise<TTSResult> => {
  if (!byteDanceAppId || !byteDanceAccessToken) {
    console.error("ByteDance App ID or Access Token is not set.");
    return { duration: 0 };
  }
  const uuid = uuidv4();
  console.time(`合成语音${uuid}`);

  const payload: Payload = {
    app: {
      appid: byteDanceAppId,
      token: byteDanceAccessToken,
      cluster: "volcano_tts",
    },
    user: {
      uid: "01",
    },
    audio: {
      voice_type: byteDanceVoiceType,
      encoding: "mp3",
      speed_ratio: 1,
      volume_ratio: 2.0,
    },
    request: {
      reqid: `req_${Date.now()}`,
      text,
      operation: "query",
    },
  };

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer;${byteDanceAccessToken}`,
  };

  try {
    const res = await axios.post(
      `https://openspeech.bytedance.com/api/v1/tts`,
      payload,
      { headers }
    );
    console.timeEnd(`合成语音${uuid}`);
    return { buffer: Buffer.from(res.data.data, "base64"), duration: res.data.addition.duration };
  } catch (err: unknown) {
    if (axios.isAxiosError(err)) {
      console.error(`合成语音${uuid}失败：`, err.response?.data || err.message);
    } else {
      console.error(`合成语音${uuid}失败：`, err);
    }
    return { duration: 0 };
  }
};

export default volcengineTTS;

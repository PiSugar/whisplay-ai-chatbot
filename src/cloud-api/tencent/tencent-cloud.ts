import mp3Duration from "mp3-duration";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import axios from "axios";
import dotenv from "dotenv";
import { TTSResult } from "../../type";

dotenv.config();

// Tencent Cloud ASR
const SECRET_ID = process.env.TENCENT_SECRET_ID || "";
const SECRET_KEY = process.env.TENCENT_SECRET_KEY || "";
const ASR_ENDPOINT =
  process.env.TENCENT_ASR_ENDPOINT || "asr.tencentcloudapi.com";
const TTS_ENDPOINT =
  process.env.TENCENT_TTS_ENDPOINT || "tts.tencentcloudapi.com";

const isTencentASRConfigValid = () => {
  if (!SECRET_ID || !SECRET_KEY || !ASR_ENDPOINT) {
    console.error("tencent asr config is not set correctly");
    return false;
  }
  return true;
};

const isTencentTTSConfigValid = () => {
  if (!SECRET_ID || !SECRET_KEY || !TTS_ENDPOINT) {
    console.error("tencent tts config is not set correctly");
    return false;
  }
  return true;
};

interface Authorization {
  authorization: string;
  timestamp: number;
}

const getAuthorization = (
  payload: string,
  service: "asr" | "tts",
): Authorization => {
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);

  const signStr = (key: crypto.BinaryLike, msg: crypto.BinaryLike) =>
    crypto.createHmac("sha256", key).update(msg).digest();

  const getSignatureKey = (key: string, date: string, service: string) => {
    const kDate = signStr("TC3" + key, date);
    const kService = signStr(kDate, service);
    const kSigning = signStr(kService, "tc3_request");
    return kSigning;
  };

  const hashedPayload = crypto
    .createHash("sha256")
    .update(payload)
    .digest("hex");
  const httpRequestMethod = "POST";
  const canonicalUri = "/";
  const canonicalQueryString = "";
  const canonicalHeaders = `content-type:application/json\nhost:${service === "asr" ? ASR_ENDPOINT : TTS_ENDPOINT}\n`;
  const signedHeaders = "content-type;host";
  const canonicalRequest = `${httpRequestMethod}\n${canonicalUri}\n${canonicalQueryString}\n${canonicalHeaders}\n${signedHeaders}\n${hashedPayload}`;
  const algorithm = "TC3-HMAC-SHA256";
  const credentialScope = `${date}/${service}/tc3_request`;
  const stringToSign = `${algorithm}\n${timestamp}\n${credentialScope}\n${crypto
    .createHash("sha256")
    .update(canonicalRequest)
    .digest("hex")}`;
  const signingKey = getSignatureKey(SECRET_KEY, date, service);
  const signature = crypto
    .createHmac("sha256", signingKey)
    .update(stringToSign)
    .digest("hex");
  const authorization = `${algorithm} Credential=${SECRET_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    authorization,
    timestamp,
  };
};

const getVoiceFormat = (audioPath: string): string => {
  const ext = path.extname(audioPath).toLowerCase().replace(/^\./, "");
  if (ext === "wav" || ext === "mp3" || ext === "m4a" || ext === "flac" || ext === "aac") {
    return ext;
  }
  // Fallback to mp3 to preserve previous behaviour for unknown extensions
  return "mp3";
};

const recognizeAudio = async (
  audioPath: string,
): Promise<string | undefined> => {
  if (!isTencentASRConfigValid()) {
    console.error("Tencent Cloud ASR configuration is incorrect");
    return "";
  }
  if (!fs.existsSync(audioPath)) {
    console.error("Audio file does not exist");
    return "";
  }
  const timeLabel = `Audio recognition ${Date.now()}`;
  console.time(timeLabel);
  const audioBuffer = fs.readFileSync(audioPath);
  const audioData = audioBuffer.toString("base64");
  const voiceFormat = getVoiceFormat(audioPath);

  const payload = JSON.stringify({
    EngSerViceType: "16k_zh",
    SourceType: 1,
    Data: audioData,
    // Tencent expects DataLen to be the size of the original audio (in bytes),
    // NOT the length of the base64-encoded string.
    DataLen: audioBuffer.length,
    VoiceFormat: voiceFormat,
  });

  const { authorization, timestamp } = getAuthorization(payload, "asr");

  const headers = {
    Authorization: authorization,
    "Content-Type": "application/json",
    Host: ASR_ENDPOINT,
    "X-TC-Action": "SentenceRecognition",
    "X-TC-Timestamp": timestamp,
    "X-TC-Version": "2019-06-14",
  };

  try {
    const res = await axios.post(`https://${ASR_ENDPOINT}`, payload, {
      headers,
    });
    const response = res.data?.Response;
    if (response?.Error) {
      console.error(
        "Tencent ASR returned an error:",
        `${response.Error.Code} - ${response.Error.Message}`,
        `(RequestId: ${response.RequestId})`,
      );
      return "";
    }
    console.log("Audio recognized result:", response?.Result);
    return response?.Result;
  } catch (err: any) {
    console.error(
      "Audio recognition failed:",
      err.response?.data || err.message,
    );
  } finally {
    console.timeEnd(timeLabel);
  }
};

const synthesizeSpeech = async (
  text: string,
): Promise<TTSResult | undefined> => {
  if (!isTencentTTSConfigValid()) {
    console.error("Tencent Cloud TTS configuration is incorrect");
    return;
  }
  const payload = JSON.stringify({
    Text: text,
    SessionId: "session-1",
    ModelType: 1,
    Volume: 10,
    Speed: 0,
    ProjectId: 0,
    VoiceType: 601009,
    EmotionCategory: "happy",
    Codec: "mp3",
  });

  const { authorization, timestamp } = getAuthorization(payload, "tts");

  const headers = {
    Authorization: authorization,
    "Content-Type": "application/json",
    Host: TTS_ENDPOINT,
    "X-TC-Action": "TextToVoice",
    "X-TC-Timestamp": timestamp,
    "X-TC-Version": "2019-08-23",
    EmotionCategory: "happy",
  };

  try {
    const res = await axios.post(`https://${TTS_ENDPOINT}`, payload, {
      headers,
    });
    console.log("Speech synthesis completed");
    const audio = res.data?.Response?.Audio;
    if (!audio) {
      console.error("Speech synthesis error:", res.data);
      return;
    }
    const buffer = Buffer.isBuffer(audio)
      ? audio
      : typeof audio === "string"
        ? Buffer.from(audio, "base64")
        : Buffer.from(audio);
    const duration = await mp3Duration(buffer);
    return { buffer, duration: duration * 1000 };
  } catch (err: any) {
    console.error(
      "Speech synthesis failed:",
      err.response?.data || err.message,
    );
  }
};

export { recognizeAudio, synthesizeSpeech };

/**
 * Test script for Tencent ASR SentenceRecognition API
 * Usage: npx ts-node src/test/test-tencent-asr.ts [audio-file-path]
 */
import crypto from "crypto";
import axios from "axios";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const SECRET_ID = process.env.TENCENT_SECRET_ID || "";
const SECRET_KEY = process.env.TENCENT_SECRET_KEY || "";
const ASR_ENDPOINT = process.env.TENCENT_ASR_ENDPOINT || "asr.tencentcloudapi.com";

function getVoiceFormat(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".wav") {
    return "wav";
  }
  if (ext === ".mp3") {
    return "mp3";
  }
  if (ext === ".m4a") {
    return "m4a";
  }
  if (ext === ".flac") {
    return "flac";
  }
  if (ext === ".aac") {
    return "aac";
  }
  throw new Error(`Unsupported audio file extension: ${ext || "(none)"}`);
}

function getAuthorization(payload: string, endpoint: string) {
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

  const hashedPayload = crypto.createHash("sha256").update(payload).digest("hex");
  const canonicalHeaders = `content-type:application/json\nhost:${endpoint}\n`;
  const signedHeaders = "content-type;host";
  const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${hashedPayload}`;
  const algorithm = "TC3-HMAC-SHA256";
  const credentialScope = `${date}/asr/tc3_request`;
  const stringToSign = `${algorithm}\n${timestamp}\n${credentialScope}\n${crypto
    .createHash("sha256")
    .update(canonicalRequest)
    .digest("hex")}`;
  const signingKey = getSignatureKey(SECRET_KEY, date, "asr");
  const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  const authorization = `${algorithm} Credential=${SECRET_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { authorization, timestamp };
}

/**
 * Generate a minimal valid WAV file with a 440Hz sine wave (16kHz, mono, 16-bit)
 */
function generateTestWav(durationSec: number = 2): Buffer {
  const sampleRate = 16000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const numSamples = sampleRate * durationSec;
  const dataSize = numSamples * numChannels * (bitsPerSample / 8);

  const buffer = Buffer.alloc(44 + dataSize);
  // RIFF header
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  // fmt chunk
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28);
  buffer.writeUInt16LE(numChannels * (bitsPerSample / 8), 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  // data chunk
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Generate 440Hz sine wave
  for (let i = 0; i < numSamples; i++) {
    const sample = Math.sin(2 * Math.PI * 440 * i / sampleRate) * 0.5 * 32767;
    buffer.writeInt16LE(Math.round(sample), 44 + i * 2);
  }
  return buffer;
}

async function testASR() {
  const inputAudioPath = process.argv[2];

  console.log("=== Tencent ASR Test ===");
  console.log(`Endpoint: ${ASR_ENDPOINT}`);
  console.log(`Secret ID: ${SECRET_ID.substring(0, 10)}...`);
  console.log();

  if (!SECRET_ID || !SECRET_KEY) {
    console.error("ERROR: TENCENT_SECRET_ID / TENCENT_SECRET_KEY not set in .env");
    process.exit(1);
  }

  let audioData: string;
  let voiceFormat: string;

  if (inputAudioPath) {
    const resolvedAudioPath = path.resolve(inputAudioPath);
    if (!fs.existsSync(resolvedAudioPath)) {
      throw new Error(`Audio file does not exist: ${resolvedAudioPath}`);
    }
    const audioBuffer = fs.readFileSync(resolvedAudioPath);
    audioData = audioBuffer.toString("base64");
    voiceFormat = getVoiceFormat(resolvedAudioPath);
    console.log(`Using input audio file: ${resolvedAudioPath}`);
    console.log(`Voice format: ${voiceFormat}`);
    console.log(`Audio size: ${audioBuffer.length} bytes, base64 length: ${audioData.length}`);
  } else {
    console.log("Generating test WAV audio (2s, 440Hz sine wave, 16kHz mono)...");
    const wavBuffer = generateTestWav(2);
    audioData = wavBuffer.toString("base64");
    voiceFormat = "wav";
    console.log(`Audio size: ${wavBuffer.length} bytes, base64 length: ${audioData.length}`);
  }
  console.log();

  const payload = JSON.stringify({
    EngSerViceType: "16k_zh",
    SourceType: 1,
    Data: audioData,
    DataLen: Buffer.byteLength(audioData),
    VoiceFormat: voiceFormat,
  });

  const { authorization, timestamp } = getAuthorization(payload, ASR_ENDPOINT);

  const headers = {
    Authorization: authorization,
    "Content-Type": "application/json",
    Host: ASR_ENDPOINT,
    "X-TC-Action": "SentenceRecognition",
    "X-TC-Timestamp": timestamp.toString(),
    "X-TC-Version": "2019-06-14",
  };

  console.log("Request headers:");
  console.log(JSON.stringify({ ...headers, Authorization: headers.Authorization.substring(0, 60) + "..." }, null, 2));
  console.log();

  console.log("Sending request to Tencent ASR...");
  console.log(`URL: https://${ASR_ENDPOINT}`);
  console.log();

  try {
    const res = await axios.post(`https://${ASR_ENDPOINT}`, payload, { headers });
    console.log("=== Full Response ===");
    console.log(JSON.stringify(res.data, null, 2));
    console.log();
    console.log("=== Key Fields ===");
    console.log(`Response.Result: ${res.data?.Response?.Result}`);
    console.log(`Response.RequestId: ${res.data?.Response?.RequestId}`);
    console.log(`Response.AudioDuration: ${res.data?.Response?.AudioDuration}`);
    if (res.data?.Response?.Error) {
      console.log(`Response.Error.Code: ${res.data.Response.Error.Code}`);
      console.log(`Response.Error.Message: ${res.data.Response.Error.Message}`);
    }
  } catch (err: any) {
    console.error("=== Request Failed ===");
    if (err.response) {
      console.error(`Status: ${err.response.status}`);
      console.error("Response data:", JSON.stringify(err.response.data, null, 2));
    } else {
      console.error("Error:", err.message);
    }
  }
}

testASR();

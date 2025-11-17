import dotenv from "dotenv";
import WebSocket from "ws";
import zlib from "zlib";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";

dotenv.config();

const byteDanceAppId = process.env.VOLCENGINE_APP_ID || "";
const byteDanceAccessToken = process.env.VOLCENGINE_ACCESS_TOKEN || "";

// Default WebSocket message headers (4 bytes)
const DefaultFullClientWsHeader = Buffer.from([0x11, 0x10, 0x11, 0x00]);
const DefaultAudioOnlyWsHeader = Buffer.from([0x11, 0x20, 0x11, 0x00]);
const DefaultLastAudioWsHeader = Buffer.from([0x11, 0x22, 0x11, 0x00]);

// Message type constants
const SERVER_FULL_RESPONSE = 0x09; // Binary 1001
const SERVER_ACK = 0x0b; // Binary 1011
const SERVER_ERROR_RESPONSE = 0x0f; // Binary 1111

// Compression and serialization flags
const GZIP = 0x01;
const JSON_TYPE = 0x01;

interface VolcengineAsrClientOptions {
  url?: string;
  appid: string;
  token: string;
  cluster: string;
  uid: string;
}

class VolcengineAsrClient {
  private appid: string;
  private token: string;
  private cluster: string;
  private workflow: string;
  private format: string;
  private codec: string;
  private url: string;
  private uid: string;
  private audioBuffers: Buffer[];
  private sendTimer: NodeJS.Timeout | null;
  private ws: WebSocket | null = null;

  public onOpen: (() => void) | null = null;
  public onMessage: ((data: any) => void) | null = null;
  public onError: ((error: any) => void) | null = null;
  public onClose: ((code: number, reason: string) => void) | null = null;

  constructor({ url, appid, token, cluster, uid }: VolcengineAsrClientOptions) {
    this.appid = appid;
    this.token = token;
    this.cluster = cluster;
    this.workflow = "audio_in,resample,partition,vad,fe,decode";
    this.format = "mp3";
    this.codec = "raw";
    this.url = url || "wss://openspeech.bytedance.com/api/v2/asr";
    this.uid = uid;

    this.audioBuffers = [];
    this.sendTimer = null;

    if (this.appid && this.token) {
      this.ws = new WebSocket(this.url, {
        headers: {
          Authorization: `Bearer;${this.token}`,
        },
      });

      this.ws.on("open", this.handleOpen.bind(this));
      this.ws.on("message", this.handleMessage.bind(this));
      this.ws.on("error", this.handleError.bind(this));
      this.ws.on("close", this.handleClose.bind(this));
    }
  }

  private handleOpen() {
    this.onOpen?.();
    const reqBuffer = this.constructRequest();
    const compressedReq = this.gzipCompress(reqBuffer);
    const payloadSizeBuffer = Buffer.alloc(4);
    payloadSizeBuffer.writeUInt32BE(compressedReq.length, 0);
    const fullClientMsg = Buffer.concat([
      DefaultFullClientWsHeader,
      payloadSizeBuffer,
      compressedReq,
    ]);
    this.ws?.send(fullClientMsg);

    this.sendTimer = setInterval(() => {
      if (this.audioBuffers.length) {
        const sends = this.audioBuffers.splice(0, this.audioBuffers.length);
        this.sendChunk(Buffer.concat(sends));
      }
    }, 500);
  }

  private handleMessage(data: WebSocket.Data) {
    const parsedData = this.parseResponse(data as Buffer);
    this.onMessage?.(parsedData);
  }

  private handleError(error: any) {
    console.error(error);
    this.onError?.(error);
  }

  private handleClose(code: number, reason: Buffer) {
    this.onClose?.(code, reason.toString());
  }

  private gzipCompress(inputBuffer: Buffer): Buffer {
    return zlib.gzipSync(inputBuffer);
  }

  private gzipDecompress(inputBuffer: Buffer): Buffer {
    return zlib.gunzipSync(inputBuffer);
  }

  private constructRequest(): Buffer {
    const reqid = uuidv4();
    const req = {
      app: {
        appid: this.appid,
        cluster: this.cluster,
        token: this.token,
      },
      user: {
        uid: this.uid,
      },
      request: {
        reqid: reqid,
        nbest: 1,
        workflow: this.workflow,
        result_type: "full",
        sequence: 1,
      },
      audio: {
        format: this.format,
        codec: this.codec,
      },
    };
    return Buffer.from(JSON.stringify(req));
  }

  private parseResponse(msgBuffer: Buffer): any {
    const header0 = msgBuffer[0];
    const headerSize = header0 & 0x0f;
    const headerBytes = headerSize * 4;
    const messageType = msgBuffer[1] >> 4;
    const serializationMethod = msgBuffer[2] >> 4;
    const messageCompression = msgBuffer[2] & 0x0f;

    const payload = msgBuffer.slice(headerBytes);
    let payloadMsg: Buffer | undefined;
    let payloadSize = 0;

    if (messageType === SERVER_FULL_RESPONSE) {
      payloadSize = payload.readUInt32BE(0);
      payloadMsg = payload.slice(4);
    } else if (messageType === SERVER_ACK) {
      const seq = payload.readUInt32BE(0);
      if (payload.length >= 8) {
        payloadSize = payload.readUInt32BE(4);
        payloadMsg = payload.slice(8);
      }
      console.log("SERVER_ACK seq:", seq);
    } else if (messageType === SERVER_ERROR_RESPONSE) {
      const code = payload.readUInt32BE(0);
      payloadSize = payload.readUInt32BE(4);
      payloadMsg = payload.slice(8);
      console.error("SERVER_ERROR_RESPONSE code:", code);
    }

    if (payloadSize === 0) {
      return {};
    }

    if (messageCompression === GZIP) {
      payloadMsg = this.gzipDecompress(payloadMsg!);
    }

    if (serializationMethod === JSON_TYPE) {
      return JSON.parse(payloadMsg!.toString());
    }

    return {};
  }

  private sendChunk(chunk: Buffer, isLastSegment = false) {
    const audioMsgHeader = isLastSegment
      ? DefaultLastAudioWsHeader
      : DefaultAudioOnlyWsHeader;
    const compressedAudio = this.gzipCompress(chunk);
    const audioPayloadSizeBuffer = Buffer.alloc(4);
    audioPayloadSizeBuffer.writeUInt32BE(compressedAudio.length, 0);
    const audioMsg = Buffer.concat([
      audioMsgHeader,
      audioPayloadSizeBuffer,
      compressedAudio,
    ]);
    if (!this.ws) {
      console.log("WebSocket is not connected, please check volcengine config");
      return;
    }
    this.ws?.send(audioMsg);
  }

  public send(audioData: Buffer) {
    this.audioBuffers.push(audioData);
  }

  public close() {
    if (this.sendTimer) {
      clearInterval(this.sendTimer);
    }
    this.ws?.close();
  }

  public async end() {
    if (this.sendTimer) {
      clearInterval(this.sendTimer);
    }
    if (this.audioBuffers.length) {
      this.sendChunk(Buffer.concat(this.audioBuffers), true);
    }
  }
}

const client = new VolcengineAsrClient({
  appid: byteDanceAppId,
  token: byteDanceAccessToken,
  cluster: "volcengine_input_common",
  uid: "01",
});

let recognizeResolve: (value: string) => void = () => "";
let timingStart = false;

client.onOpen = () => {
  console.log("ASR WebSocket connection established");
};

client.onMessage = (data) => {
  const astText = data?.result?.[0]?.text || "";
  if (timingStart) {
    console.timeEnd("Audio recognition");
    timingStart = false;
  }
  console.log("Recognition result:", astText);
  recognizeResolve(astText);
};

export const recognizeAudio = (audioPath: string): Promise<string> => {
  console.time("Audio recognition");
  timingStart = true;
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(audioPath)) {
      console.error("Audio file does not exist");
      resolve("");
      return;
    }
    const audioData = fs.readFileSync(audioPath);
    client.send(audioData);
    recognizeResolve = resolve;
  });
};

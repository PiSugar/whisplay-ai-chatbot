require("dotenv").config();

/*
 * MIT License
 *
 * Copyright (c) 2025-至今 小明IO
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 * @author 小明IO
 * @email  1746809408@qq.com
 * @github https://github.com/wangzongming/esp-ai
 * @websit https://espai.fun
 */
const WebSocket = require("ws");
const zlib = require("zlib");
const { v4: uuidv4 } = require("uuid");
const fs = require("fs");
const path = require("path");

// 默认 WebSocket 消息头（4 字节）
const DefaultFullClientWsHeader = Buffer.from([0x11, 0x10, 0x11, 0x00]);
const DefaultAudioOnlyWsHeader = Buffer.from([0x11, 0x20, 0x11, 0x00]);
const DefaultLastAudioWsHeader = Buffer.from([0x11, 0x22, 0x11, 0x00]);

// 消息类型常量
const SERVER_FULL_RESPONSE = 0x09; // 二进制 1001
const SERVER_ACK = 0x0b; // 二进制 1011
const SERVER_ERROR_RESPONSE = 0x0f; // 二进制 1111

// 压缩与序列化标识
const GZIP = 0x01;
const JSON_TYPE = 0x01;

class VolcengineAsrClient {
  constructor({ url, appid, token, cluster, uid }) {
    this.appid = appid;
    this.token = token;
    this.cluster = cluster;
    // 固定的工作流
    this.workflow = "audio_in,resample,partition,vad,fe,decode";
    // 默认音频格式与编解码方式
    this.format = "mp3";
    this.codec = "raw";
    this.url = url || "wss://openspeech.bytedance.com/api/v2/asr";
    this.onOpen = null;
    this.onMessage = null;
    this.onError = null;
    this.onClose = null;
    this.uid = uid;

    // 全部音频
    this.audioBuffers = [];
    this.sendTimer = null;

    this.ws = new WebSocket(this.url, {
      headers: {
        Authorization: `Bearer;${this.token}`,
      },
    });

    // test...
    // this.writeStreamMP3 = fs.createWriteStream(path.join(__dirname, `./test.mp3`));

    this.ws.on("open", async () => {
      this.onOpen && this.onOpen();
      const reqBuffer = this.constructRequest();
      const compressedReq = this.gzipCompress(reqBuffer);
      const payloadSizeBuffer = Buffer.alloc(4);
      payloadSizeBuffer.writeUInt32BE(compressedReq.length, 0);
      const fullClientMsg = Buffer.concat([
        DefaultFullClientWsHeader,
        payloadSizeBuffer,
        compressedReq,
      ]);
      this.ws.send(fullClientMsg);

      clearInterval(this.sendTimer);
      this.sendTimer = setInterval(() => {
        if (this.audioBuffers.length) {
          const sends = this.audioBuffers.splice(0, this.audioBuffers.length);
          this.sendChunk(Buffer.concat(sends));
        }
      }, 500);
    });
    this.ws.on("message", (data) => {
      this.onMessage && this.onMessage(this.parseResponse(data));
    });
    this.ws.on("error", (data) => {
      console.log(data);
      this.onError && this.onError(data);
    });
    this.ws.on("close", (data) => {
      this.onClose && this.onClose(data);
    });
  }

  // 使用 zlib 进行 gzip 压缩
  gzipCompress(inputBuffer) {
    return zlib.gzipSync(inputBuffer);
  }

  // 使用 zlib 进行 gzip 解压
  gzipDecompress(inputBuffer) {
    return zlib.gunzipSync(inputBuffer);
  }

  // 构造 full client 请求（JSON 对象转 Buffer）
  constructRequest() {
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
    const reqStr = JSON.stringify(req);
    return Buffer.from(reqStr);
  }

  // 解析服务器返回的二进制消息
  parseResponse(msgBuffer) {
    const header0 = msgBuffer[0];
    const headerSize = header0 & 0x0f; // header 的字节数除以 4
    const headerBytes = headerSize * 4;
    const messageType = msgBuffer[1] >> 4;
    const serializationMethod = msgBuffer[2] >> 4;
    const messageCompression = msgBuffer[2] & 0x0f;

    const payload = msgBuffer.slice(headerBytes);
    let payloadMsg;
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
      // throw new Error(payloadMsg.toString());
    }

    if (payloadSize === 0) {
      // throw new Error("payload size is 0");
    }

    // 如果消息经过 gzip 压缩，则先解压
    if (messageCompression === GZIP) {
      payloadMsg = this.gzipDecompress(payloadMsg);
    }

    let asrResponse = {};
    if (serializationMethod === JSON_TYPE) {
      asrResponse = JSON.parse(payloadMsg.toString());
    }

    return asrResponse;
  }

  sendChunk(chunk, isLastSegment) {
    // test...
    // this.writeStreamMP3.write(chunk);
    let audioMsgHeader;
    if (!isLastSegment) {
      audioMsgHeader = DefaultAudioOnlyWsHeader;
    } else {
      audioMsgHeader = DefaultLastAudioWsHeader;
    }
    const compressedAudio = this.gzipCompress(chunk);
    const audioPayloadSizeBuffer = Buffer.alloc(4);
    audioPayloadSizeBuffer.writeUInt32BE(compressedAudio.length, 0);
    const audioMsg = Buffer.concat([
      audioMsgHeader,
      audioPayloadSizeBuffer,
      compressedAudio,
    ]);
    this.ws.send(audioMsg);
  }

  send(audioData) {
    this.audioBuffers.push(audioData);
  }
  // 等待 WebSocket 返回下一条消息
  waitForMessage(ws) {
    return new Promise((resolve, reject) => {
      this.ws.once("message", (data) => {
        resolve(data);
      });
      this.ws.once("error", (err) => {
        reject(err);
      });
    });
  }

  close() {
    clearInterval(this.sendTimer);
    this.ws.close();
  }
  async end() {
    clearInterval(this.sendTimer);
    this.audioBuffers.length &&
      this.sendChunk(Buffer.concat(this.audioBuffers), true);
  }
}

const client = new VolcengineAsrClient({
  appid: process.env.BYTE_DANCE_APP_ID,
  token: process.env.BYTE_DANCE_ACCESS_TOKEN,
  cluster: "volcano_asr",
  uid: "01",
});

let recognizeResolve = () => "";

client.onMessage = (data) => {
  const astText = data?.result?.[0]?.text || "";
  recognizeResolve(astText);
};

const recognizeAudio = (audioPath) => {
  return new Promise((resolve, reject) => {
    const audioData = fs.readFileSync(audioPath);
    client.send(audioData);
    recognizeResolve = resolve;
  });
};

module.exports = recognizeAudio;

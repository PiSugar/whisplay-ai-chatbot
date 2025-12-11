import { Type as GeminiType } from "@google/genai";
import { get, isArray } from "lodash";
import { FunctionCall } from "../type";
import moment from "moment";
import { exec } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import mp3Duration from "mp3-duration";

// 输入 [[{"function":{"arguments":"","name":"setVolume"},"id":"call_wdpwgmiszun2ej6radzriaq0","index":0,"type":"function"}],[{"function":{"arguments":" {\""},"index":0}],[{"function":{"arguments":"volume"},"index":0}],[{"function":{"arguments":"\":"},"index":0}],[{"function":{"arguments":" "},"index":0}],[{"function":{"arguments":"2"},"index":0}],[{"function":{"arguments":"1"},"index":0}],[{"function":{"arguments":"}"},"index":0}]]
// 输出 [{"function":{"arguments":" {\"volume\": 21}","name":"setVolume"},"id":"call_wdpwgmiszun2ej6radzriaq0","index":0,"type":"function"}]
export const combineFunction = (packages: FunctionCall[][]): FunctionCall[] => {
  return packages.reduce((callFunctions: FunctionCall[], itemArray) => {
    if (!isArray(itemArray)) {
      itemArray = [itemArray];
    }
    itemArray.forEach((call) => {
      const index = call.index;
      if (callFunctions[index]) {
        const existingCall = callFunctions[index];
        const existingArguments = get(existingCall, "function.arguments", "");
        const newArguments = get(call, "function.arguments", "");
        const combinedArguments = existingArguments + newArguments;
        const combinedCall: FunctionCall = {
          ...existingCall,
          function: {
            ...existingCall.function,
            arguments: combinedArguments,
          },
        };
        callFunctions[index] = combinedCall;
      } else {
        callFunctions[index] = call;
      }
    });
    return callFunctions;
  }, []);
};

// combineFunction([[{"function":{"arguments":"","name":"setVolume"},"id":"call_wdpwgmiszun2ej6radzriaq0","index":0,"type":"function"}],[{"function":{"arguments":" {\""},"index":0}],[{"function":{"arguments":"volume"},"index":0}],[{"function":{"arguments":"\":"},"index":0}],[{"function":{"arguments":" "},"index":0}],[{"function":{"arguments":"2"},"index":0}],[{"function":{"arguments":"1"},"index":0}],[{"function":{"arguments":"}"},"index":0}]])

export const extractEmojis = (str: string): string => {
  const array = [
    ...str.matchAll(/([\p{Emoji_Presentation}\u200d\ufe0f])/gu),
  ].map((match) => match[0]);

  if (array.length > 0) {
    return array[0];
  }
  return "😐";
};

export const getCurrentTimeTag = (): string => {
  return moment().format("YYYY-MM-DD HH:mm:ss");
};

export function splitSentences(text: string): {
  sentences: string[];
  remaining: string;
} {
  const regex = /.*?([。！？!?，,]|\.)(?=\s|$)/gs;

  const sentences: string[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const sentence = match[0].trim();
    // Check if the sentence is just numbers and punctuations
    if (/[0-9\.。！？!?，,]/.test(sentence)) {
      sentences.push(sentence);
      lastIndex = regex.lastIndex;
    } else {
      // If it's just numbers and punctuations, reset lastIndex to include this in the next match
      regex.lastIndex = match.index;
      break;
    }
  }

  const remaining = text.slice(lastIndex).trim();

  // merge short sentences
  const newSentences: string[] = [];
  let buffer = "";
  sentences.forEach((sentence) => {
    if ((buffer + `${sentence} `).length <= 60) {
      buffer += `${sentence} `;
    } else {
      if (buffer) {
        newSentences.push(buffer);
      }
      buffer = `${sentence} `;
    }
  });
  if (buffer) {
    newSentences.push(buffer);
  }

  return { sentences: newSentences, remaining };
}

export function getPcmWavDurationMs(
  buffer: Buffer<ArrayBuffer>,
  params: {
    channels?: number;
    sampleRate?: number;
    sampleWidth?: number;
  }
): number {
  const dataLength = buffer.length;

  const channels = params.channels || 1;
  const sampleRate = params.sampleRate || 16000;
  const sampleWidth = params.sampleWidth || 2; // 每个采样字节数（16-bit）

  const durationSeconds = dataLength / (sampleRate * channels * sampleWidth);
  return Math.round(durationSeconds * 1000);
}

export function getWavFileDurationMs(buffer: Buffer<ArrayBuffer>): number {
  // WAV 文件头部信息在前 44 字节
  const header = buffer.subarray(0, 44);
  const channels = header.readUInt16LE(22); // 通道数
  const sampleRate = header.readUInt32LE(24); // 采样率
  const sampleWidth = header.readUInt16LE(34) / 8; // 每个采样字节数（位深度除以8）
  const body = buffer.subarray(44);

  return getPcmWavDurationMs(body, {
    sampleRate,
    channels,
    sampleWidth,
  });
}

export const killAllProcesses = (pid: number) => {
  exec(`ps --ppid ${pid} -o pid=`, (err, stdout, stderr) => {
    if (err) {
      console.error("Error getting child processes:", stderr);
      return;
    }
    // 子进程 PID 输出在 stdout 中
    const childPids = stdout.trim().split("\n");

    // 给父进程和所有子进程发送 kill 信号
    const allPids = [pid, ...childPids];
    allPids.forEach((childPid) => {
      exec(`kill -2 ${childPid}`, (err, stdout, stderr) => {
        if (err) {
          console.error(`Error killing process ${childPid}:`, stderr);
        } else {
          console.log(`Killed process ${childPid}`);
        }
      });
    });
  });
};

export const transformToGeminiType = (parameters: Object) => {
  // 遍历 parameters 对象，将所有key为type字段值转换为geminiType的类型
  const jsonString = JSON.stringify(parameters);
  const newObject = JSON.parse(jsonString, (key, value) => {
    if (key === "type") {
      switch (value) {
        case "string":
          return GeminiType.STRING;
        case "number":
          return GeminiType.NUMBER;
        case "integer":
          return GeminiType.INTEGER;
        case "boolean":
          return GeminiType.BOOLEAN;
        case "array":
          return GeminiType.ARRAY;
        case "object":
          return GeminiType.OBJECT;
        default:
          return value;
      }
    }
    return value;
  });
  return newObject;
};

export const purifyTextForTTS = (text: string): string => {
  // Remove emojis and special characters
  return text
    .replace(/[*#~]|[\p{Emoji_Presentation}\u200d\ufe0f]/gu, "")
    .trim();
};

export const getRecordFileDurationMs = async (
  filePath: string
): Promise<number> => {
  const format = filePath.endsWith(".mp3") ? "mp3" : "wav";
  if (!existsSync(filePath)) return 0;
  try {
    const data = readFileSync(filePath);
    if (format === "wav") {
      return getWavFileDurationMs(data);
    } else if (format === "mp3") {
      return (await mp3Duration(data)) * 1000;
    }
  } catch (error) {
    return 0;
  }
  return 0;
};

export function pcmToWav(
  pcmBuffer: Buffer,
  sampleRate = 24000,
  numChannels = 1
) {
  const bytesPerSample = 2; // LINEAR16 = 16bit = 2 bytes
  const byteRate = sampleRate * numChannels * bytesPerSample;

  const header = Buffer.alloc(44);

  // ChunkID "RIFF"
  header.write("RIFF", 0);
  // ChunkSize = 36 + SubChunk2Size
  header.writeUInt32LE(36 + pcmBuffer.length, 4);
  // Format "WAVE"
  header.write("WAVE", 8);

  // Subchunk1ID "fmt "
  header.write("fmt ", 12);
  // Subchunk1Size = 16 for PCM
  header.writeUInt32LE(16, 16);
  // AudioFormat = 1 (PCM)
  header.writeUInt16LE(1, 20);
  // NumChannels
  header.writeUInt16LE(numChannels, 22);
  // SampleRate
  header.writeUInt32LE(sampleRate, 24);
  // ByteRate
  header.writeUInt32LE(byteRate, 28);
  // BlockAlign
  header.writeUInt16LE(numChannels * bytesPerSample, 32);
  // BitsPerSample
  header.writeUInt16LE(bytesPerSample * 8, 34);

  // Subchunk2ID "data"
  header.write("data", 36);
  // Subchunk2Size = pcmBuffer.length
  header.writeUInt32LE(pcmBuffer.length, 40);

  return Buffer.concat([header, pcmBuffer]);
}

export function savePcmAsWav(
  pcmBuffer: Buffer,
  outputPath: string,
  sampleRate = 24000,
  numOfChannels = 1
) {
  const wavBuffer = pcmToWav(pcmBuffer, sampleRate, numOfChannels);
  writeFileSync(outputPath, wavBuffer);
  console.log("Saved WAV:", outputPath);
}

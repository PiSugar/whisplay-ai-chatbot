// 输入 [[{"function":{"arguments":"","name":"setVolume"},"id":"call_wdpwgmiszun2ej6radzriaq0","index":0,"type":"function"}],[{"function":{"arguments":" {\""},"index":0}],[{"function":{"arguments":"volume"},"index":0}],[{"function":{"arguments":"\":"},"index":0}],[{"function":{"arguments":" "},"index":0}],[{"function":{"arguments":"2"},"index":0}],[{"function":{"arguments":"1"},"index":0}],[{"function":{"arguments":"}"},"index":0}]]
// 输出 [{"function":{"arguments":" {\"volume\": 21}","name":"setVolume"},"id":"call_wdpwgmiszun2ej6radzriaq0","index":0,"type":"function"}]

import { get, isArray } from "lodash";
import { FunctionCall } from "../type";
import moment from "moment";

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
  const regex =
    /.*?([。！？!?，,]|\.)(?=\s|$)/gs;

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

export function getPcmWavDurationMs(buffer: Buffer<ArrayBuffer>, params: {
  channels?: number;
  sampleRate?: number;
  sampleWidth?: number;
}): number {
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
  // const channels = header.readUInt16LE(22); // 通道数
  // const sampleRate = header.readUInt32LE(24); // 采样率
  const byteRate = header.readUInt32LE(28); // 字节率
  const dataLength = buffer.length - 44; // 音频数据长度
  const durationSeconds = dataLength / byteRate;
  return Math.round(durationSeconds * 1000);
}
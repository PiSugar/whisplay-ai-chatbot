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
    /.*?([。！？!?，,]|[\uD800-\uDBFF][\uDC00-\uDFFF]|\.)(?=\s|$)/gs;

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

  return { sentences, remaining };
}

export function getPcmWavDurationMs(buffer: Buffer<ArrayBuffer>): number {
  const dataLength = buffer.length;

  const channels = 1;
  const sampleRate = 24000;
  const sampleWidth = 2; // 每个采样字节数（16-bit）

  const durationSeconds = dataLength / (sampleRate * channels * sampleWidth);
  return Math.round(durationSeconds * 1000);
}

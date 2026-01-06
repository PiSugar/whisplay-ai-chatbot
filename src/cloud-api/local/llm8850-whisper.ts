import axios from "axios";
import dotenv from "dotenv";
import fs from "fs";
import { defaultPortMap } from "./common";

dotenv.config();

const whisperServiceHost =
  process.env.LLM8850_WHISPER_HOST ||
  `http://localhost:${defaultPortMap.llm8850whisper}`;

interface WhisperResponse {
  filePath: string;
  recognition: string;
}

export const recognizeAudio = async (
  audioFilePath: string
): Promise<string> => {
  const audioData = fs.readFileSync(audioFilePath);
  const base64Audio = audioData.toString("base64");

  return axios
    .post<WhisperResponse>(whisperServiceHost + "/recognize", {
      filePath: audioFilePath,
      base64: base64Audio,
    })
    .then((response) => {
      if (response.data && response.data.recognition) {
        return response.data.recognition;
      } else {
        console.error("Invalid response from Whisper service:", response.data);
        return "";
      }
    })
    .catch((error) => {
      console.error("Error calling Whisper service:", error);
      return "";
    });
};

import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const whisperServiceUrl =
  process.env.WHISPER_SERVICE_URL || "http://localhost:8801/recognize";

interface WhisperResponse {
  filePath: string;
  recognition: string;
}

export const recognizeAudio = async (
  audioFilePath: string
): Promise<string> => {
  return axios
    .post<WhisperResponse>(
      whisperServiceUrl,
      {
        filePath: audioFilePath,
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    )
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

import fs from "fs";
import {
  TranscribeStreamingClient,
  StartStreamTranscriptionCommand,
  LanguageCode,
  MediaEncoding,
} from "@aws-sdk/client-transcribe-streaming";
import { AWS_REGION, getAwsCredentials, hasAwsCredentials, awsTranscribeLanguageCode } from "./aws";

const recognizeAudio = async (
  audioFilePath: string
): Promise<string> => {
  if (!hasAwsCredentials()) {
    console.error("AWS credentials are not set.");
    return "";
  }
  if (!fs.existsSync(audioFilePath)) {
    console.error("Audio file does not exist:", audioFilePath);
    return "";
  }

  try {
    const client = new TranscribeStreamingClient({
      region: AWS_REGION,
      credentials: getAwsCredentials(),
    });

    const audioBuffer = fs.readFileSync(audioFilePath);
    // Strip WAV header (44 bytes) to get raw PCM data.
    // Ensure the size is manageable or split if necessary.
    const pcmBuffer = audioBuffer.length > 44 ? audioBuffer.subarray(44) : audioBuffer;

    const audioStream = async function* () {
      const chunkSize = 16 * 1024; // 16KB chunks
      for (let i = 0; i < pcmBuffer.length; i += chunkSize) {
        yield {
          AudioEvent: {
            AudioChunk: pcmBuffer.subarray(i, i + chunkSize),
          },
        };
      }
    };

    const command = new StartStreamTranscriptionCommand({
      LanguageCode: awsTranscribeLanguageCode as LanguageCode,
      MediaEncoding: MediaEncoding.PCM,
      MediaSampleRateHertz: 16000,
      AudioStream: audioStream(),
    });

    const response = await client.send(command);

    let transcription = "";
    if (response.TranscriptResultStream) {
      for await (const event of response.TranscriptResultStream) {
        if (event.TranscriptEvent && event.TranscriptEvent.Transcript?.Results) {
          const results = event.TranscriptEvent.Transcript.Results;
          for (const result of results) {
            if (result.Alternatives && result.Alternatives.length > 0 && !result.IsPartial) {
              transcription += (result.Alternatives[0].Transcript || "") + " ";
            }
          }
        }
      }
    }

    return transcription.trim();
  } catch (error) {
    console.error("AWS Transcribe streaming failed:", error);
    return "";
  }
};

export { recognizeAudio };

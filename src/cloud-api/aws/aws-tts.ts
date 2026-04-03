import path from "path";
import fs from "fs";
import getAudioDurationInSeconds from "get-audio-duration";
import { ttsDir } from "../../utils/dir";
import { TTSResult } from "../../type";
import { PollyClient, SynthesizeSpeechCommand, OutputFormat, Engine, VoiceId, LanguageCode } from "@aws-sdk/client-polly";
import { AWS_REGION, getAwsCredentials, hasAwsCredentials, awsPollyVoice, awsPollyEngine, awsPollyLanguageCode } from "./aws";

const synthesizeSpeech = async (text: string): Promise<TTSResult> => {
  if (!hasAwsCredentials()) {
    console.error("AWS credentials are not set.");
    return { duration: 0 };
  }

  try {
    const client = new PollyClient({
      region: AWS_REGION,
      credentials: getAwsCredentials(),
    });

    const command = new SynthesizeSpeechCommand({
      Engine: awsPollyEngine as Engine,
      LanguageCode: awsPollyLanguageCode as LanguageCode,
      OutputFormat: OutputFormat.MP3,
      Text: text,
      VoiceId: awsPollyVoice as VoiceId,
    });

    const response = await client.send(command);

    if (!response.AudioStream) {
      console.error("No audio content received from AWS Polly");
      return { duration: 0 };
    }

    // Convert AudioStream (which is a ReadableStream or Blob) to buffer
    const audioData = await response.AudioStream.transformToByteArray();
    const buffer = Buffer.from(audioData);

    const filePath = path.join(ttsDir, `aws_tts_${Date.now()}.mp3`);
    fs.writeFileSync(filePath, buffer);

    return {
      filePath,
      duration: await getAudioDurationInSeconds(filePath) * 1000,
    };
  } catch (error) {
    console.error("AWS Polly error:", error);
    return { duration: 0 };
  }
};

export default synthesizeSpeech;

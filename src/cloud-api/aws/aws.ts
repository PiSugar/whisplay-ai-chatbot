import dotenv from "dotenv";

dotenv.config();

export const AWS_REGION = process.env.AWS_REGION || "us-east-1";
export const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || "";
export const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || "";

export const awsBedrockModel = process.env.AWS_BEDROCK_MODEL || "anthropic.claude-3-sonnet-20240229-v1:0";
export const awsBedrockVisionModel = process.env.AWS_BEDROCK_VISION_MODEL || "us.anthropic.claude-3-5-sonnet-20241022-v2:0";
export const awsBedrockImageModel = process.env.AWS_BEDROCK_IMAGE_MODEL || "amazon.titan-image-generator-v2:0";
export const awsBedrockEmbeddingModel = process.env.AWS_BEDROCK_EMBEDDING_MODEL || "amazon.titan-embed-text-v2:0";
export const awsS3VectorBucket = process.env.AWS_S3_VECTOR_BUCKET || "";
export const awsPollyVoice = process.env.AWS_POLLY_VOICE || "Joanna";
export const awsPollyEngine = (process.env.AWS_POLLY_ENGINE as any) || "neural";
export const awsPollyLanguageCode = process.env.AWS_POLLY_LANGUAGE_CODE || "en-US";
export const awsTranscribeLanguageCode = process.env.AWS_TRANSCRIBE_LANGUAGE || "en-US";
export const awsFacesCollectionId = process.env.AWS_FACES_COLLECTION_ID || "";

export const getAwsCredentials = () => {
  if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
    return undefined;
  }
  return {
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY,
  };
};

export const hasAwsCredentials = () => {
    return Boolean(AWS_ACCESS_KEY_ID) && Boolean(AWS_SECRET_ACCESS_KEY);
};

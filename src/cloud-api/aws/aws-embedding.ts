import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { AWS_REGION, getAwsCredentials, hasAwsCredentials, awsBedrockEmbeddingModel } from "./aws";

const client = hasAwsCredentials()
  ? new BedrockRuntimeClient({ region: AWS_REGION, credentials: getAwsCredentials() })
  : null;

export const embedText = async (text: string): Promise<number[]> => {
  if (!client) {
    console.error("AWS credentials not found. Cannot fetch embeddings.");
    return [];
  }

  try {
    const payload = {
      inputText: text,
    };

    const command = new InvokeModelCommand({
      modelId: awsBedrockEmbeddingModel,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify(payload),
    });

    const response = await client.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    if (responseBody.embedding) {
      return responseBody.embedding;
    } else {
      console.error("Invalid response from AWS Bedrock Embeddings API:", responseBody);
      return [];
    }
  } catch (error) {
    console.error("Error fetching embeddings from AWS:", error);
    return [];
  }
};

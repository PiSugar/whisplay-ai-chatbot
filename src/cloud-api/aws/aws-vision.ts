import { LLMTool, ToolReturnTag } from "../../type";
import { getLatestShowedImage } from "../../utils/image";
import { readFileSync } from "fs";
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { AWS_REGION, getAwsCredentials, hasAwsCredentials, awsBedrockVisionModel } from "./aws";

const client = hasAwsCredentials()
  ? new BedrockRuntimeClient({ region: AWS_REGION, credentials: getAwsCredentials() })
  : null;

export const addAwsVisionTool = (visionTools: LLMTool[]) => {
  if (!client) {
    return;
  }

  visionTools.push({
    type: "function",
    function: {
      name: "describeImage",
      description:
        "Use this tool when user wants to analyze and interpret an image with the help of vision model, the tool will get the latest showed image by itself and answer questions about the image.",
      parameters: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description:
              "The query or prompt to help with interpreting the image, e.g., 'What is in this image?'",
          },
        },
        required: ["prompt"],
      },
    },
    func: async (params) => {
      const { prompt } = params;
      const imgPath = getLatestShowedImage();
      
      if (!imgPath) {
        return `${ToolReturnTag.Error} No image is found.`;
      }
      
      try {
        const imageBuffer = readFileSync(imgPath);
        
        let format = "jpeg";
        const lowerPath = imgPath.toLowerCase();
        if (lowerPath.endsWith(".png")) format = "png";
        else if (lowerPath.endsWith(".gif")) format = "gif";
        else if (lowerPath.endsWith(".webp")) format = "webp";

        const command = new ConverseCommand({
          modelId: awsBedrockVisionModel,
          messages: [
            {
              role: "user",
              content: [
                {
                   image: {
                     format: format as any,
                     source: { bytes: new Uint8Array(imageBuffer) }
                   }
                },
                { text: prompt }
              ]
            }
          ]
        });

        const response = await client.send(command);
        const textContent = response.output?.message?.content?.[0]?.text;

        return textContent
          ? `${ToolReturnTag.Success}${textContent}`
          : `${ToolReturnTag.Error} No content received from Bedrock Vision.`;

      } catch (error: any) {
        console.error("Error analyzing image via AWS Bedrock Vision:", error.message);
        return `${ToolReturnTag.Error} AWS Bedrock Vision processing failed: ${error.message}`;
      }
    },
  });
};

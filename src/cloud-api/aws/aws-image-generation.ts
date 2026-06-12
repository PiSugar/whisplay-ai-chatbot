import { LLMTool, ToolReturnTag } from "../../type";
import { getImageMimeType, getLatestShowedImage, setLatestGenImg } from "../../utils/image";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import path from "path";
import { imageDir } from "../../utils/dir";
import { readFileSync, writeFileSync } from "fs";
import { AWS_REGION, getAwsCredentials, hasAwsCredentials, awsBedrockImageModel } from "./aws";

const client = hasAwsCredentials()
  ? new BedrockRuntimeClient({ region: AWS_REGION, credentials: getAwsCredentials() })
  : null;

export const addAwsGenerationTool = (imageGenerationTools: LLMTool[]) => {
  if (!client) {
    return;
  }
  imageGenerationTools.push({
    type: "function",
    function: {
      name: "generateImage",
      description: "Generate or draw an image from a text prompt, or edit an image based on a text prompt.",
      parameters: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description: "The text prompt to generate the image from",
          },
          withImageContext: {
            type: "boolean",
            description:
              "When user mentions 'this image/picture/photo' or similar, set this to true, the tools will request and provide context from the latest showed image",
          },
        },
        required: ["prompt"],
      },
    },
    func: async (params: { prompt: string; withImageContext: boolean }) => {
      console.log(`Generating image with AWS Bedrock model: ${awsBedrockImageModel}`);
      const { prompt, withImageContext } = params;

      let conditionImage = undefined;
      if (withImageContext) {
        const latestImgPath = getLatestShowedImage();
        if (latestImgPath) {
          conditionImage = readFileSync(latestImgPath, { encoding: "base64" });
        }
      }

      const payload: any = {
        taskType: "TEXT_IMAGE",
        textToImageParams: {
          text: prompt,
        },
        imageGenerationConfig: {
          numberOfImages: 1,
          quality: "standard",
          width: 1024,
          height: 1024,
          cfgScale: 8.0
        }
      };

      if (conditionImage) {
        payload.textToImageParams.conditionImage = conditionImage;
        payload.textToImageParams.controlMode = "SEGMENTATION";
      }

      try {
        const command = new InvokeModelCommand({
          modelId: awsBedrockImageModel,
          contentType: "application/json",
          accept: "application/json",
          body: JSON.stringify(payload)
        });

        const response = await client.send(command);
        const responseBody = JSON.parse((response.body as any).transformToString());

        let isSuccess = false;

        if (responseBody.images && responseBody.images.length > 0) {
          const base64Data = responseBody.images[0];
          const fileName = `aws-image-${Date.now()}.png`;
          const imagePath = path.join(imageDir, fileName);
          const buffer = Buffer.from(base64Data, "base64");

          writeFileSync(imagePath, buffer);
          setLatestGenImg(imagePath);
          isSuccess = true;
          console.log(`Image saved as ${imagePath}`);
        }

        return isSuccess
          ? `${ToolReturnTag.Success}Image file saved.`
          : `${ToolReturnTag.Error}Image generation failed (No images returned).`;

      } catch (error: any) {
        console.error("Error generating image via AWS Bedrock:", error.message);
        return `${ToolReturnTag.Error}Image generation failed: ${error.message}`;
      }
    },
  });
};

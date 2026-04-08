import { LLMTool, ToolReturnTag } from "../../type";
import { getLatestShowedImage } from "../../utils/image";
import { readFileSync } from "fs";
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { RekognitionClient, SearchUsersByImageCommand, DetectLabelsCommand } from "@aws-sdk/client-rekognition";
import { AWS_REGION, getAwsCredentials, hasAwsCredentials, awsBedrockVisionModel, awsFacesCollectionId } from "./aws";

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

  visionTools.push({
    type: "function",
    function: {
      name: "detectLabels",
      description:
        "Detect objects, scenes, and concepts in the latest showed image. Returns a list of labels with confidence scores.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
    func: async () => {
      const imgPath = getLatestShowedImage();
      if (!imgPath) {
        return `${ToolReturnTag.Error} No image is found.`;
      }

      try {
        const imageBuffer = readFileSync(imgPath);

        const rekognitionClient = new RekognitionClient({
          region: AWS_REGION,
          credentials: getAwsCredentials(),
        });

        const command = new DetectLabelsCommand({
          Image: {
            Bytes: new Uint8Array(imageBuffer),
          },
          MaxLabels: 20,
          MinConfidence: 50.0,
          Features: ["GENERAL_LABELS"],
        });

        const response = await rekognitionClient.send(command);

        const labels = response.Labels || [];
        if (labels.length === 0) {
          return `${ToolReturnTag.Success} No labels detected in the image.`;
        }

        const labelsList = labels
          .map((label: any) => `${label.Name} (${Math.round(label.Confidence || 0)}%)`)
          .join("\n");
          
        return `${ToolReturnTag.Success}\n${labelsList}`;
      } catch (error: any) {
        console.error("Error detecting labels via AWS Rekognition:", error.message);
        return `${ToolReturnTag.Error} AWS Rekognition label detection failed: ${error.message}`;
      }
    },
  });

  if (awsFacesCollectionId) {
    visionTools.push({
      type: "function",
      function: {
        name: "detectFaces",
        description:
          "Analyze the latest showed image to detect and identify faces against a known user collection. Returns recognized UserIds and the count of unrecognized faces.",
        parameters: {
          type: "object",
          properties: {},
        },
      },
      func: async () => {
        const imgPath = getLatestShowedImage();
        if (!imgPath) {
          return `${ToolReturnTag.Error} No image is found.`;
        }

        try {
          const imageBuffer = readFileSync(imgPath);

          const rekognitionClient = new RekognitionClient({
            region: AWS_REGION,
            credentials: getAwsCredentials(),
          });

          const command = new SearchUsersByImageCommand({
            CollectionId: awsFacesCollectionId,
            Image: {
              Bytes: new Uint8Array(imageBuffer),
            },
            MaxUsers: 10, // max users threshold per matched face
            UserMatchThreshold: 70.0,
          });

          const response = await rekognitionClient.send(command);

          const matchedIds =
            response.UserMatches?.flatMap((match: any) =>
              match.User?.UserId ? [match.User.UserId] : []
            ) || [];
          const unsearchedCount = response.UnsearchedFaces?.length || 0;

          let resultMsg = "";
          if (matchedIds.length > 0) {
            resultMsg += `Recognized User IDs: [${matchedIds.join(", ")}]. `;
          } else {
            resultMsg += `No known users recognized in the primary face. `;
          }

          if (unsearchedCount > 0) {
            resultMsg += `There are ${unsearchedCount} other faces in the image that did not match or were not searched.`;
          }

          return `${ToolReturnTag.Success} ${resultMsg.trim()}`;
        } catch (error: any) {
          console.error("Error detecting faces via AWS Rekognition:", error.message);
          return `${ToolReturnTag.Error} AWS Rekognition face detection failed: ${error.message}`;
        }
      },
    });
  }
};

import { ImageGenerationServer, LLMTool } from "../type";
import axios from "axios";
import dotenv from "dotenv";
import {
  setLatestGenImg,
  showLatestCapturedImg,
  showLatestGenImg,
} from "../utils/image";
import { gemini } from "../cloud-api/gemini";
import { GenerateContentResponse } from "@google/genai";
import path from "path";
import { imageDir } from "../utils/dir";
import { writeFileSync } from "fs";
import { openai } from "../cloud-api/openai";
import { ImageGenerateParamsNonStreaming } from "openai/resources/images";
import { isEmpty } from "lodash";

dotenv.config();

const enableCamera = process.env.ENABLE_CAMERA === "true";

const visionTools: LLMTool[] = [];

if (enableCamera) {
  visionTools.push({
    type: "function",
    function: {
      name: "showCapturedImage",
      description: "Show the lastest captured image",
      parameters: {},
    },
    func: async (params) => {
      const result = showLatestCapturedImg();
      return result
        ? "[success] Ready to show."
        : "[error] No captured image to display.";
    },
  });
}

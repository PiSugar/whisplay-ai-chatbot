import { registerASRPlugins } from "./asr";
import { registerLLMPlugins } from "./llm";
import { registerTTSPlugins } from "./tts";
import { registerImageGenerationPlugins } from "./image-generation";
import { registerVisionPlugins } from "./vision";
import { registerLLMToolsPlugins } from "./llm-tools";

export function registerBuiltinPlugins(): void {
  registerASRPlugins();
  registerLLMPlugins();
  registerTTSPlugins();
  registerImageGenerationPlugins();
  registerVisionPlugins();
  registerLLMToolsPlugins();
}

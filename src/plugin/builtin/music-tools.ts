import { pluginRegistry } from "../registry";
import { LLMToolsPlugin } from "../types";
import { LLMTool, ToolReturnTag } from "../../type";
import { getLocalMusicPlayer } from "../../device/music-player";

export function registerMusicToolsPlugins(): void {
  const hasConfiguredMusicDir = (process.env.MUSIC_LIBRARY_DIRS || "")
    .split(",")
    .map((item) => item.trim())
    .some(Boolean);

  if (!hasConfiguredMusicDir) {
    console.log("[LLM-Tools] Skip music-tools plugin: MUSIC_LIBRARY_DIRS is not configured.");
    return;
  }

  // Preload local music index at startup so play requests can use in-memory matching.
  void getLocalMusicPlayer(process.env).preloadLibrary();

  pluginRegistry.register({
    name: "music-tools",
    displayName: "Local Music Tools",
    version: "1.0.0",
    type: "llm-tools",
    description: "Built-in local music search and playback tools",
    activate: (ctx) => {
      const player = getLocalMusicPlayer(ctx.env);

      return {
        getTools: (): LLMTool[] => [
          {
            type: "function",
            function: {
              name: "playMusic",
              description:
                "Play local music from configured folders by fuzzy-matching the user query.",
              parameters: {
                type: "object",
                properties: {
                  query: {
                    type: "string",
                    description: "song name or keywords to search in local music library",
                  },
                },
                required: ["query"],
              },
            },
            func: async (params: any) => {
              const query = String(params?.query || "").trim();
              if (!query) {
                return `${ToolReturnTag.Error}Missing required parameter: query.`;
              }

              const result = await player.playByQuery(query);
              if (!result.ok) {
                return `${ToolReturnTag.Error}${result.message}`;
              }

              return `${ToolReturnTag.Success}${result.message} (${result.trackPath})`;
            },
          },
        ],
      };
    },
  } as LLMToolsPlugin);
}

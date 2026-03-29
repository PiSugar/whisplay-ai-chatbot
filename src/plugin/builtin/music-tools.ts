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

  // Preload local music index at startup
  void getLocalMusicPlayer(process.env).preloadLibrary();

  pluginRegistry.register({
    name: "music-tools",
    displayName: "Local Music Tools",
    version: "1.0.0",
    type: "llm-tools",
    description: "Local music playback with continuous random play support",
    activate: (ctx) => {
      const player = getLocalMusicPlayer(ctx.env);

      return {
        getTools: (): LLMTool[] => [
          {
            type: "function",
            function: {
              name: "playMusic",
              description:
                "Play a specific song from the music library by name. When the song ends, it will automatically continue playing random songs until the user presses the button to stop.",
              parameters: {
                type: "object",
                properties: {
                  query: {
                    type: "string",
                    description: "Song name or keywords to search in the music library",
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

              // playMusic: play single track only (continuous = false)
              const result = await player.playByQuery(query, false);
              if (!result.ok) {
                return `${ToolReturnTag.Error}${result.message}`;
              }

              return `${ToolReturnTag.Success}${result.message}`;
            },
          },
          {
            type: "function",
            function: {
              name: "playMusicRandom",
              description:
                "Play a random song from the music library. When the song ends, it will automatically play another random song continuously until the user presses the button to stop.",
              parameters: {
                type: "object",
                properties: {},
              },
            },
            func: async () => {
              const result = await player.playRandom();
              if (!result.ok) {
                return `${ToolReturnTag.Error}${result.message}`;
              }
              return `${ToolReturnTag.Success}${result.message}`;
            },
          },
        ],
      };
    },
  } as LLMToolsPlugin);
}

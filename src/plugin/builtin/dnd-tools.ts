/**
 * D&D 5e Dungeon Master Tools Plugin
 * 
 * Integrates the Python-based D&D agent with the whisplay-ai-chatbot system.
 * Provides dice rolling, character management, and combat facilitation tools.
 */

import { LLMToolsPlugin } from "../types";
import { LLMTool } from "../../type";
import { exec } from "child_process";
import { promisify } from "util";
import * as path from "path";

const execAsync = promisify(exec);

export function registerDnDToolsPlugins(): void {
  const { pluginRegistry } = require("../registry");
  
  // Path to the D&D agent directory (relative to project root)
  const DND_AGENT_PATH = path.resolve(__dirname, "../../../dnd-agent");

  /**
   * Helper function to execute D&D agent CLI commands
   */
  async function execDnDCommand(args: string[]): Promise<string> {
    try {
      const fullPath = path.join(DND_AGENT_PATH, "dnd_agent.py");
      const cmd = `python "${fullPath}" ${args.join(" ")}`;
      
      const { stdout, stderr } = await execAsync(cmd, {
        cwd: DND_AGENT_PATH,
        timeout: 30000,
        maxBuffer: 1024 * 1024
      });
      
      return stdout.trim() || stderr.trim();
    } catch (error: any) {
      return `Error executing D&D command: ${error.message}`;
    }
  }

  pluginRegistry.register({
    name: "dnd-tools",
    displayName: "D&D 5e Tools",
    version: "1.0.0",
    type: "llm-tools",
    description: "Interactive D&D 5e tools for dice rolling, character management, and combat",
    activate: () => {
      return {
        getTools: (): LLMTool[] => [
          {
            type: "function",
            function: {
              name: "rollDice",
              description: "Roll dice using D&D notation (e.g., 2d6+3, 1d20, d100). Supports both virtual and physical dice modes.",
              parameters: {
                type: "object",
                properties: {
                  notation: {
                    type: "string",
                    description: "Dice notation (e.g., 2d6+3, 1d20+5, d100)",
                  },
                  interactive: {
                    type: "boolean",
                    description: "Whether to prompt for physical dice (true) or roll virtually (false)",
                  },
                },
                required: ["notation"],
              },
            },
            func: async (params: any) => {
              const { notation, interactive = false } = params;
              let cmdArgs = ["roll", notation];
              if (interactive) {
                cmdArgs.push("--interactive");
              }
              return await execDnDCommand(cmdArgs);
            },
          },
          {
            type: "function",
            function: {
              name: "makeAbilityCheck",
              description: "Make an ability check with modifiers for a character. Supports virtual/physical dice and advantage/disadvantage.",
              parameters: {
                type: "object",
                properties: {
                  character: {
                    type: "string",
                    description: "Character name",
                  },
                  ability: {
                    type: "string",
                    enum: ["STR", "DEX", "CON", "INT", "WIS", "CHA"],
                    description: "Ability being checked",
                  },
                  skill: {
                    type: "string",
                    description: "Optional skill name (e.g., stealth, perception, arcana)",
                  },
                  advantage: {
                    type: "boolean",
                    description: "Whether to roll with advantage",
                  },
                  disadvantage: {
                    type: "boolean",
                    description: "Whether to roll with disadvantage",
                  },
                  interactive: {
                    type: "boolean",
                    description: "Whether to prompt for physical dice",
                  },
                },
                required: ["character", "ability"],
              },
            },
            func: async (params: any) => {
              const { character, ability, skill, advantage, disadvantage, interactive } = params;
              let cmdArgs = ["check", character, ability];
              if (skill) cmdArgs.push("--skill", skill);
              if (advantage) cmdArgs.push("--advantage");
              if (disadvantage) cmdArgs.push("--disadvantage");
              if (interactive) cmdArgs.push("--interactive");
              return await execDnDCommand(cmdArgs);
            },
          },
          {
            type: "function",
            function: {
              name: "makeSavingThrow",
              description: "Make a saving throw for a character against a specific DC.",
              parameters: {
                type: "object",
                properties: {
                  character: {
                    type: "string",
                    description: "Character name",
                  },
                  ability: {
                    type: "string",
                    enum: ["STR", "DEX", "CON", "INT", "WIS", "CHA"],
                    description: "Ability saving throw type",
                  },
                  dc: {
                    type: "number",
                    description: "Difficulty class to beat",
                  },
                  interactive: {
                    type: "boolean",
                    description: "Whether to prompt for physical dice",
                  },
                },
                required: ["character", "ability"],
              },
            },
            func: async (params: any) => {
              const { character, ability, dc, interactive } = params;
              let cmdArgs = ["save", character, ability.toLowerCase()];
              if (dc !== undefined) cmdArgs.push("--dc", dc.toString());
              if (interactive) cmdArgs.push("--interactive");
              return await execDnDCommand(cmdArgs);
            },
          },
          {
            type: "function",
            function: {
              name: "createCharacter",
              description: "Create a new D&D 5e character with random or specified ability scores.",
              parameters: {
                type: "object",
                properties: {
                  name: {
                    type: "string",
                    description: "Character name",
                  },
                  race: {
                    type: "string",
                    description: "Character race (e.g., Human, Elf, Dwarf)",
                  },
                  className: {
                    type: "string",
                    description: "Character class (e.g., Wizard, Fighter, Rogue)",
                  },
                  level: {
                    type: "number",
                    description: "Character level",
                  },
                  background: {
                    type: "string",
                    description: "Character background",
                  },
                },
                required: ["name", "race", "className"],
              },
            },
            func: async (params: any) => {
              const { name, race, className, level = 1, background = "" } = params;
              let cmdArgs = ["create-character", name, race, className, "--level", level.toString()];
              if (background) cmdArgs.push("--background", background);
              return await execDnDCommand(cmdArgs);
            },
          },
          {
            type: "function",
            function: {
              name: "rollInitiative",
              description: "Roll initiative for a group of characters.",
              parameters: {
                type: "object",
                properties: {
                  characters: {
                    type: "array",
                    items: { type: "string" },
                    description: "List of character names",
                  },
                },
                required: ["characters"],
              },
            },
            func: async (params: any) => {
              const { characters } = params;
              return await execDnDCommand(["initiative", ...characters]);
            },
          },
          {
            type: "function",
            function: {
              name: "generateEncounter",
              description: "Generate a random encounter description for various environments.",
              parameters: {
                type: "object",
                properties: {
                  environment: {
                    type: "string",
                    enum: ["dungeon", "forest", "city", "tavern"],
                    description: "Environment type for the encounter",
                  },
                },
              },
            },
            func: async (params: any) => {
              const { environment = "dungeon" } = params;
              return await execDnDCommand(["encounter", environment]);
            },
          },
          {
            type: "function",
            function: {
              name: "rollOnTable",
              description: "Roll on various D&D random tables.",
              parameters: {
                type: "object",
                properties: {
                  tableName: {
                    type: "string",
                    description: "Table name: tavern_patron, weather, dungeon_encounter, treasure",
                  },
                },
              },
            },
            func: async (params: any) => {
              const { tableName = "tavern_patron" } = params;
              return await execDnDCommand(["table", tableName]);
            },
          },
        ],
      };
    },
  } as LLMToolsPlugin);
}
import { LLMTool } from "../../type";
import net from "net";

const demoTools: LLMTool[] = [
  {
    type: "function",
    function: {
      name: "switchLight",
      description: "Switch the light on or off",
      parameters: {
        type: "object",
        properties: {
          action: {
            description: "Action to perform on the light",
            type: "string",
            enum: ["start", "stop"],
          },
        },
        required: ["action"],
      },
    },
    func: async (params) => {
      if (
        !params.action ||
        (params.action !== "start" && params.action !== "stop")
      ) {
        return "Invalid action. Please specify 'start' or 'stop'.";
      }
      const result = await new Promise((resolve, reject) => {
        const client = new net.Socket();
        client.connect(8888, "192.168.100.98", () => {
          client.write(
            JSON.stringify({ action: params.action, effect: "rainbow" })
          );
          client.end();
          resolve(`Light switched ${params.action}`);
        });
        client.on("error", (err: any) => {
          console.error("Light Socket error:", err);
          reject(err);
        });
      }).catch((err) => {
        return `Failed to switch light: ${err.message}`;
      });
      return result as string;
    },
  },
];

export default demoTools;

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
      // 连接到0.0.0.0:8888的socket服务器并发送 { "action": "start", "effect": "rainbow" }
      if (!params.action || (params.action !== "start" && params.action !== "stop")) {
        return "Invalid action. Please specify 'start' or 'stop'.";
      }
      const client = new net.Socket();
      client.connect(8888, "0.0.0.0", () => {
        client.write(JSON.stringify({ action: params.action, effect: "rainbow" }));
      });
      // Implement the logic to switch the light
      return `Light switched ${params.action}`;
    },
  },
]

export default demoTools;

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: any[];
  tool_call_id?: string;
}

export interface FunctionCall {
  function: {
    arguments: string;
    name?: string;
  };
  id?: string;
  index: number;
  type?: string;
}
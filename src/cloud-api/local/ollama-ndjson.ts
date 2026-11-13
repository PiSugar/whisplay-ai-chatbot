import { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";

export async function readOllamaNDJSON(stream: Readable, onRecord: (record: any) => void): Promise<void> {
  const decoder = new StringDecoder("utf8");
  let pending = "";
  let done = false;
  for await (const chunk of stream) {
    const lines = (pending + decoder.write(chunk)).split("\n");
    pending = lines.pop()!;
    for (const line of lines) {
      if (!line.trim()) continue;
      if (done) throw new Error("Unexpected Ollama record after done=true");
      const record = JSON.parse(line);
      if (!record || typeof record !== "object" || Array.isArray(record)) {
        throw new Error("Invalid Ollama NDJSON record");
      }
      if (typeof record.error === "string") throw new Error(record.error);
      done = record.done === true;
      onRecord(record);
    }
  }
  if ((pending + decoder.end()).trim()) throw new Error("Truncated Ollama NDJSON record");
  if (!done) throw new Error("Ollama stream ended before done=true");
}

import { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";

export async function readOllamaNDJSON(stream: Readable, onRecord: (record: any) => void): Promise<void> {
  const decoder = new StringDecoder("utf8");
  let pending = "";
  let done = false;
  const readRecord = (line: string, atEnd = false) => {
    if (!line.trim()) return;
    if (done) throw new Error("Unexpected Ollama record after done=true");
    const record = JSON.parse(line);
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new Error("Invalid Ollama NDJSON record");
    }
    if (typeof record.error === "string") throw new Error(record.error);
    done = record.done === true;
    if (atEnd && !done) throw new Error("Ollama stream ended before done=true");
    onRecord(record);
  };
  for await (const chunk of stream) {
    const lines = (pending + decoder.write(chunk)).split("\n");
    pending = lines.pop()!;
    for (const line of lines) readRecord(line);
  }
  readRecord(pending + decoder.end(), true);
  if (!done) throw new Error("Ollama stream ended before done=true");
}

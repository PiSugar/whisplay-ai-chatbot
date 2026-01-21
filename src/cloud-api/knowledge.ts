import VectorDB from "./local/qdrant-vectordb";
import { embedText as ollamaEmbedText } from "./local/ollama-embedding";
import { summaryTextWithLLM } from "./llm";
import { EmbeddingServer, VectorDBServer } from "../type";

const embeddingServer = (process.env.EMBEDDING_SERVER || "ollama")
  .toLowerCase()
  .trim();
const vectorDBServer = (process.env.VECTOR_DB_SERVER || "qdrant")
  .toLowerCase()
  .trim();
const envEnableRAG = (process.env.ENABLE_RAG || "false").toLowerCase() === "true";

let vectorDB: VectorDB = null as any;

switch (vectorDBServer) {
  case VectorDBServer.qdrant:
    vectorDB = new VectorDB();
    break;
  default:
    throw new Error(
      `Unsupported VECTOR_DB_SERVER: ${vectorDBServer}. Supported options are: qdrant.`,
    );
}

let embedText: ((text: string) => Promise<number[]>) = null as any;

switch (embeddingServer) {
  case EmbeddingServer.ollama:
    embedText = ollamaEmbedText;
    break;
  default:
    throw new Error(
      `Unsupported EMBEDDING_SERVER: ${embeddingServer}. Supported options are: ollama.`,
    );
}

let enableRAG = envEnableRAG;

if (envEnableRAG && (!vectorDB || !embedText)) {
  console.warn(
    `[RAG] RAG is enabled but required components are missing. Disabling RAG.`,
  );
  enableRAG = false;
}

export { vectorDB, embedText, summaryTextWithLLM, enableRAG };

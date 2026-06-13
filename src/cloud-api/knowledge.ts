import { summaryTextWithLLM } from "./llm";
import { EmbeddingServer, VectorDBServer } from "../type";
import type { VectorDBClass } from "./interface";

const embeddingServer = (process.env.EMBEDDING_SERVER || "ollama")
  .toLowerCase()
  .trim();
const vectorDBServer = (process.env.VECTOR_DB_SERVER || "qdrant")
  .toLowerCase()
  .trim();
const envEnableRAG = (process.env.ENABLE_RAG || "false").toLowerCase() === "true";

let vectorDBInstance: VectorDBClass | null = null;

function getVectorDB(): VectorDBClass {
  if (vectorDBInstance) return vectorDBInstance;

  switch (vectorDBServer) {
    case VectorDBServer.qdrant: {
      const VectorDB = require("./local/qdrant-vectordb").default;
      vectorDBInstance = new VectorDB();
      break;
    }
    case VectorDBServer.aws: {
      const AWSVectorDB = require("./aws/aws-vectordb").default;
      vectorDBInstance = new AWSVectorDB();
      break;
    }
    default:
      throw new Error(
        `Unsupported VECTOR_DB_SERVER: ${vectorDBServer}. Supported options are: qdrant, aws.`,
      );
  }

  return vectorDBInstance as VectorDBClass;
}

const vectorDB = new Proxy(
  {},
  {
    get(_target, prop) {
      const db = getVectorDB() as any;
      const value = db[prop];
      return typeof value === "function" ? value.bind(db) : value;
    },
  },
) as VectorDBClass;

let embedTextImpl: ((text: string) => Promise<number[]>) | null = null;

function getEmbedText(): (text: string) => Promise<number[]> {
  if (embedTextImpl) return embedTextImpl;

  switch (embeddingServer) {
    case EmbeddingServer.ollama:
      embedTextImpl = require("./local/ollama-embedding").embedText;
      break;
    case EmbeddingServer.aws:
      embedTextImpl = require("./aws/aws-embedding").embedText;
      break;
    default:
      throw new Error(
        `Unsupported EMBEDDING_SERVER: ${embeddingServer}. Supported options are: ollama, aws.`,
      );
  }

  return embedTextImpl as (text: string) => Promise<number[]>;
}

const embedText = async (text: string): Promise<number[]> => getEmbedText()(text);

const enableRAG = envEnableRAG;

export { vectorDB, embedText, summaryTextWithLLM, enableRAG };

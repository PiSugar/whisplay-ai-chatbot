import VectorDB from "./local/qdrant-vectordb";
import { embedText as ollamaEmbedText } from "./local/ollama-embedding";


// TODO
const vectorDB = new VectorDB();
const embedText = ollamaEmbedText;

export {
  vectorDB,
  embedText,
};

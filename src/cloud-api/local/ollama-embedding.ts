import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const ollamaEndpoint = process.env.OLLAMA_EMBEDDING_ENDPOINT || process.env.OLLAMA_ENDPOINT || "http://localhost:11434";
const ollamaEmbeddingModel =
  process.env.OLLAMA_EMBEDDING_MODEL || "nomic-embed-text";
const embeddingServer = (process.env.EMBEDDING_SERVER || "").toLowerCase().trim();

if (embeddingServer === "ollama") {
  // wake request to prevent cold start
  axios.post(`${ollamaEndpoint}/api/embed`, {
    model: ollamaEmbeddingModel,
    input: "wake up",
    keep_alive: -1,
  })
  .then((res) => {
    console.log('[embedding wake request]', res.data);
  })
  .catch(() => {
    // ignore errors
  });
}

export const embedText = async (text: string): Promise<number[]> => {
  try {
    const response = await axios.post(`${ollamaEndpoint}/api/embed`, {
      model: ollamaEmbeddingModel,
      input: text,
      keep_alive: -1,
    });

    if (
      response.data &&
      response.data.embeddings &&
      response.data.embeddings.length > 0
    ) {
      return response.data.embeddings[0];
    } else {
      console.error(
        "Invalid response from Ollama embeddings API:",
        response.data
      );
      return [];
    }
  } catch (error) {
    console.error("Error fetching embeddings from Ollama:", error);
    return [];
  }
};

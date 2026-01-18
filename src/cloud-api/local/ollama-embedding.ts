import axios from "axios";

const ollamaEndpoint = process.env.OLLAMA_ENDPOINT || "http://localhost:11434";
const ollamaEmbeddingModel =
  process.env.OLLAMA_EMBEDDING_MODEL || "nomic-embed-text";
const embeddingServer = (process.env.EMBEDDING_SERVER || "ollama").toLowerCase().trim();

if (embeddingServer === "ollama") {
  // wake request to prevent cold start
  axios.post(`${ollamaEndpoint}/api/embeddings`, {
    model: ollamaEmbeddingModel,
    input: "wake up",
  })
  .then((res) => {
    console.log('[embedding wake request]', res);
  })
  .catch(() => {
    // ignore errors
  });
}

export const embedText = async (text: string): Promise<number[]> => {
  try {
    const response = await axios.post(`${ollamaEndpoint}/api/embeddings`, {
      model: ollamaEmbeddingModel,
      input: text,
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

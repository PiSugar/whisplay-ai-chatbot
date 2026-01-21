import { vectorDB, embedText, summaryTextWithLLM, enableRAG } from "../cloud-api/knowledge";
import { knowledgeDir } from "../utils/dir";
import fs from "fs";
import { chunkText } from "../utils/knowledge";
import { v4 as uuidv4 } from "uuid";

const collectionName = "whisplay_knowledge";
const knowledgeScoreThreshold = parseFloat(
  process.env.RAG_KNOWLEDGE_SCORE_THRESHOLD || "0.65",
);

export async function createKnowledgeCollection() {

  if (!enableRAG) {
    console.log(
      "[RAG] RAG is disabled. Skipping knowledge collection creation.",
    );
    return;
  }

  // delete existing collection if any
  await vectorDB.deleteCollection(collectionName);

  // get dimension of embeddings
  const dimension = await embedText("test").then(
    (embedding) => embedding.length,
  );

  console.log(`Creating knowledge collection with dimension: ${dimension}`);

  // get all .txt and .md files in knowledgeDir
  const files = fs
    .readdirSync(knowledgeDir)
    .filter((file) => file.endsWith(".txt") || file.endsWith(".md"));

  // clear existing collection
  await vectorDB.createCollection(collectionName, dimension, "Cosine");

  if (!files.length) {
    console.log("No knowledge files found to index.");
    return;
  }

  for (const file of files) {
    const filePath = `${knowledgeDir}/${file}`;
    const content = fs.readFileSync(filePath, "utf-8");
    const chunks = chunkText(content, 500, 80);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const embedding = await embedText(chunk);
      console.log(`Embedding chunk ${i + 1}/${chunks.length} of file ${file}`);
      const summary = await summaryTextWithLLM(chunk);
      await vectorDB.upsertPoints(collectionName, [
        {
          id: uuidv4(),
          vector: embedding,
          payload: { content: chunk, summary, source: file, chunkIndex: i },
        },
      ]);
    }

    console.log(`Indexed file: ${file}`);
  }
}

export async function queryKnowledgeBase(query: string, topK: number = 3) {
  const queryEmbedding = await embedText(query);
  const results = await vectorDB.search(collectionName, queryEmbedding, topK);
  return results;
}

export async function retrieveKnowledgeByIds(ids: string[]) {
  return await vectorDB.retrieve(collectionName, ids);
}

export async function getSystemPromptWithKnowledge(query: string) {
  let results: {
    id: number | string;
    score: number;
    payload?:
      | { [key: string]: unknown }
      | Record<string, unknown>
      | undefined
      | null;
  }[] = [];
  try {
    results = await queryKnowledgeBase(query, 1);
  } catch (error) {
    console.error("[RAG] Error querying knowledge base:", error);
    return "";
  }
  if (results.length === 0) {
    console.log("[RAG] No knowledge found.");
    return "";
  }
  const topResult = results[0];
  if (topResult.score < knowledgeScoreThreshold) {
    console.log("[RAG] Top knowledge score below threshold:", topResult.score);
    return "";
  }
  const knowledgeId = topResult.id as string;
  const knowledgeData = await retrieveKnowledgeByIds([knowledgeId]);
  if (knowledgeData.length === 0) {
    return "";
  }
  const knowledgeContent = knowledgeData[0].payload!.summary || knowledgeData[0].payload!.content;
  return `Use the following knowledge to assist in answering the question:\n${knowledgeContent}\n`;
}

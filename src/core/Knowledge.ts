import { vectorDB, embedText } from "../cloud-api/knowledge";
import { knowledgeDir } from "../utils/dir";
import fs from "fs";
import { chunkText } from "../utils/knowledge";
import { v4 as uuidv4 } from "uuid";

const collectionName = "whisplay_knowledge";

export async function createKnowledgeCollection() {

  // delete existing collection if any
  await vectorDB.deleteCollection(collectionName);

  // get dimension of embeddings
  const dimension = await embedText("test").then(embedding => embedding.length);

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
      await vectorDB.upsertPoints(collectionName, [
        {
          id: uuidv4(),
          vector: embedding,
          payload: { content: chunk, source: file, chunkIndex: i},
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
  const results = await queryKnowledgeBase(query, 1);
  if (results.length === 0) {
    return ""
  }
  const topResult = results[0];
  const knowledgeId = topResult.id as string;
  const knowledgeData = await retrieveKnowledgeByIds([knowledgeId]);
  if (knowledgeData.length === 0) {
    return ""
  }
  const knowledgeContent = knowledgeData[0].payload!.content;
  return `Use the following knowledge to assist in answering the question:\n\n${knowledgeContent}\n\n`;
}
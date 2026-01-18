import { vectorDB, embedText } from "../cloud-api/knowledge";
import { knowledgeDir } from "../utils/dir";
import fs from "fs";
import { chunkText } from "../utils/knowledge";
import { v4 as uuidv4 } from "uuid";

const collectionName = "whisplay_knowledge";

export async function createKnowledgeCollection() {

  // delete existing collection if any
  await vectorDB.deleteCollection(collectionName);

  // get all .txt and .md files in knowledgeDir
  const files = fs
    .readdirSync(knowledgeDir)
    .filter((file) => file.endsWith(".txt") || file.endsWith(".md"));

  // clear existing collection
  await vectorDB.createCollection(collectionName, 1536, "Cosine");

  if (!files.length) {
    console.log("No knowledge files found to index.");
    return;
  }

  for (const file of files) {
    const filePath = `${knowledgeDir}/${file}`;
    const content = fs.readFileSync(filePath, "utf-8");
    const chunks = chunkText(content);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const embedding = await embedText(chunk);

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

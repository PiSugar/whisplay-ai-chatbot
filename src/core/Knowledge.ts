import { vectorDB, embedText, summaryTextWithLLM, enableRAG } from "../cloud-api/knowledge";
import { knowledgeDir } from "../utils/dir";
import fs from "fs";
import { chunkText } from "../utils/knowledge";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import readline from "readline";

const collectionName = "whisplay_knowledge";
const knowledgeScoreThreshold = parseFloat(
  process.env.RAG_KNOWLEDGE_SCORE_THRESHOLD || "0.65",
);
const promptPrefix = process.env.RAG_KNOWLEDGE_SUMMARY_PROMPT_PREFIX || "Please provide a concise summary for the following text in **30 words** or less:";
const enableKnowledgeSummary = (process.env.ENABLE_KNOWLEDGE_SUMMARY || "").toLowerCase() === "true";

export async function indexKnowledgeCollection() {

  if (!enableRAG) {
    console.log(
      "[RAG] RAG is disabled. Skipping knowledge collection creation.",
    );
    return;
  }

  const dimension = await embedText("test").then(
    (embedding) => embedding.length,
  );

  const collections = await vectorDB.getCollections();
  const collectionExists = collections.includes(collectionName);
  let shouldRecreate = false;

  if (collectionExists) {
    const collectionInfo = await vectorDB.getCollection(collectionName);
    const existingDimension = getCollectionVectorSize(collectionInfo);
    if (existingDimension && existingDimension !== dimension) {
      shouldRecreate = await promptYesNo(
        `\nEmbedding dimension mismatch (existing: ${existingDimension}, current: ${dimension}). Full reindex required. Continue? (y/N): `
      );
      if (!shouldRecreate) {
        console.log("Aborted indexing due to dimension mismatch.");
        return;
      }
    } else {
      const choice = await promptChoice(
        "\nChoose indexing mode: \n\n(i)ncremental \n(f)ull rebuild (WARNING: This operation will delete existing data). \n\n[i]: ",
        "i"
      );
      shouldRecreate = choice === "f";
    }
  } else {
    shouldRecreate = true;
  }

  if (shouldRecreate) {
    if (collectionExists) {
      await vectorDB.deleteCollection(collectionName);
    }
    console.log(`Creating knowledge collection with dimension: ${dimension}`);
    await vectorDB.createCollection(collectionName, dimension, "Cosine");
  }

  const files = fs
    .readdirSync(knowledgeDir)
    .filter((file) => file.endsWith(".txt") || file.endsWith(".md"));

  if (!files.length) {
    console.log("No knowledge files found to index.");
  }

  const fileSet = new Set(files);

  for (const file of files) {
    const filePath = `${knowledgeDir}/${file}`;
    const content = fs.readFileSync(filePath, "utf-8");
    const fileHash = hashText(content);

    const existingInfo = await getExistingFileInfo(file);
    if (existingInfo.exists && existingInfo.hash === fileHash) {
      console.log(`Skipping unchanged file: ${file}`);
      continue;
    }

    if (existingInfo.exists) {
      await vectorDB.deletePointsByFilter(collectionName, buildSourceFilter(file));
    }

    const chunks = chunkText(content, 500, 80);
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const embedding = await embedText(chunk);
      console.log(`Embedding chunk ${i + 1}/${chunks.length} of file ${file}`);
      const summary = enableKnowledgeSummary
        ? await summaryTextWithLLM(chunk, promptPrefix)
        : "";
      await vectorDB.upsertPoints(collectionName, [
        {
          id: uuidv4(),
          vector: embedding,
          payload: {
            content: chunk,
            summary,
            source: file,
            chunkIndex: i,
            fileHash,
          },
        },
      ]);
    }

    console.log(`Indexed file: ${file}`);
  }

  const deletedSources = await getDeletedSources(fileSet);
  if (deletedSources.length > 0) {
    const answer = await promptYesNo(
      `Detected ${deletedSources.length} removed knowledge files. Remove related knowledge? (y/N): `
    );
    if (answer) {
      for (const source of deletedSources) {
        await vectorDB.deletePointsByFilter(collectionName, buildSourceFilter(source));
        console.log(`Removed knowledge for file: ${source}`);
      }
    }
  }
}

function getCollectionVectorSize(collectionInfo: any): number | null {
  const vectors = collectionInfo?.config?.params?.vectors;
  if (!vectors) {
    return null;
  }
  if (typeof vectors.size === "number") {
    return vectors.size;
  }
  if (typeof vectors === "object") {
    const first = Object.values(vectors)[0] as any;
    if (first && typeof first.size === "number") {
      return first.size;
    }
  }
  return null;
}

function hashText(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function buildSourceFilter(source: string) {
  return {
    must: [
      {
        key: "source",
        match: {
          value: source,
        },
      },
    ],
  };
}

async function getExistingFileInfo(file: string): Promise<{ exists: boolean; hash: string | null }> {
  let offset: number | string | null = null;
  let hasPoints = false;
  let fileHash: string | null = null;

  do {
    const response = await vectorDB.scroll(collectionName, 256, buildSourceFilter(file), offset, true);
    const points = response?.points || [];
    if (points.length > 0) {
      hasPoints = true;
    }
    for (const point of points) {
      const payloadHash = point?.payload?.fileHash;
      if (typeof payloadHash === "string") {
        if (fileHash && fileHash !== payloadHash) {
          return { exists: true, hash: null };
        }
        if (!fileHash) {
          fileHash = payloadHash;
        }
      }
    }
    offset = response?.next_page_offset as any ?? null;
  } while (offset !== null && offset !== undefined);

  return { exists: hasPoints, hash: fileHash };
}

async function getDeletedSources(fileSet: Set<string>): Promise<string[]> {
  const sources = new Set<string>();
  let offset: number | string | null = null;

  do {
    const response = await vectorDB.scroll(collectionName, 512, undefined, offset, true);
    const points = response?.points || [];
    for (const point of points) {
      const source = point?.payload?.source;
      if (typeof source === "string") {
        sources.add(source);
      }
    }
    offset = response?.next_page_offset as number ?? null;
  } while (offset !== null && offset !== undefined);

  return Array.from(sources).filter((source) => !fileSet.has(source));
}

async function promptYesNo(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    console.log("[RAG] Non-interactive environment. Using default: no.");
    return false;
  }
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return await new Promise<boolean>((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      resolve(normalized === "y" || normalized === "yes");
    });
  });
}

async function promptChoice(question: string, defaultValue: string): Promise<string> {
  if (!process.stdin.isTTY) {
    console.log("[RAG] Non-interactive environment. Using default choice.");
    return defaultValue;
  }
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return await new Promise<string>((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      resolve(normalized || defaultValue);
    });
  });
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

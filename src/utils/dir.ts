import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const cleanDataFolderOnStart =
  process.env.CLEAN_DATA_FOLDER_ON_START === "true";

function ensureDirExists(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`created directory: ${dirPath}`);
  } else {
    console.log(`directory exists: ${dirPath}`);
  }
}

export const dataDir = path.join(__dirname, "../..", "data");
function cleanupDataDir(): void {
  fs.rmSync(dataDir, { recursive: true, force: true });
  console.log(`cleaned up directory: ${dataDir}`);
}

if (cleanDataFolderOnStart) {
  cleanupDataDir();
}

ensureDirExists(dataDir);

export const ttsDir = path.join(dataDir, "tts");
ensureDirExists(ttsDir);

export const recordingsDir = path.join(dataDir, "recordings");
ensureDirExists(recordingsDir);

export const chatHistoryDir = path.join(dataDir, "chat_history");
ensureDirExists(chatHistoryDir);

export const imageDir = path.join(dataDir, "images");
ensureDirExists(imageDir);

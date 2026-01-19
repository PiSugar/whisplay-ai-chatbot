import { createKnowledgeCollection } from "./core/Knowledge";
import dotenv from "dotenv";

dotenv.config();

createKnowledgeCollection()
  .catch((e) => {
    console.error("Failed to create knowledge collection:", e);
  })
  .finally(() => {
    console.log("Finished creating knowledge collection.");
    process.exit(0);
  });

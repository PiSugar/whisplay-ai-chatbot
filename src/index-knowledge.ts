import { indexKnowledgeCollection } from "./core/Knowledge";

indexKnowledgeCollection()
  .catch((e) => {
    console.error("Failed to create knowledge collection:", e);
  })
  .finally(() => {
    console.log("Finished creating knowledge collection.");
    process.exit(0);
  });

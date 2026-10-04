import fs from "fs";
import { submitBatch, ImportItem } from "../lib/submit";

const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: npm run import:file -- path/to/data.json");
  process.exit(1);
}

async function main() {
  const raw = fs.readFileSync(filePath, "utf-8");
  const items: ImportItem[] = JSON.parse(raw);

  if (!Array.isArray(items)) {
    console.error("File must contain a JSON array of { text, sourceType, senderId? } objects");
    process.exit(1);
  }

  console.log(`Loaded ${items.length} item(s) from ${filePath}`);
  const result = await submitBatch(items);

  console.log("\nDone.");
  console.log(`  Imported: ${result.imported}`);
  console.log(`  Skipped (duplicate): ${result.skippedDuplicate}`);
  console.log(`  Skipped (invalid): ${result.skippedInvalid}`);
  if (result.errors.length > 0) result.errors.forEach((e) => console.log(`  Error: ${e}`));
  console.log("\nRun `npm run worker` to process imported items.");
}

main();

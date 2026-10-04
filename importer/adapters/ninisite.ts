/**
 * Adapter for Ninisite-format scraped data: an array of topics, each with a
 * post and an array of comments. Both posts and comments are imported as
 * separate submissions, using Ninisite's own user IDs as senderId so
 * multiple posts/comments from the same person map to one reporter.
 *
 * Usage: npm run import:ninisite -- path/to/ninisite_final.json
 *
 * Expected input shape:
 *   [
 *     {
 *       "topic_id": "...",
 *       "post_user_id": "...",
 *       "post_text": "...",
 *       "comments": [
 *         { "comment_user_id": "...", "comment_text": "..." },
 *         ...
 *       ]
 *     },
 *     ...
 *   ]
 * post_date/comment_date/topic_id/matched_keywords are read from the file
 * but not sent — we don't track original post dates (see project notes).
 */
import fs from "fs";
import { submitBatch, ImportItem } from "../lib/submit";

const SOURCE_TYPE = "ninisite";
const MIN_LENGTH = 10;

interface NinisiteComment {
  comment_user_id?: string;
  comment_text?: string;
}

interface NinisiteTopic {
  topic_id?: string;
  post_user_id?: string;
  post_text?: string;
  comments?: NinisiteComment[];
}

const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: npm run import:ninisite -- path/to/ninisite_final.json");
  process.exit(1);
}

function buildItems(topics: NinisiteTopic[]): ImportItem[] {
  const items: ImportItem[] = [];

  for (const topic of topics) {
    const postText = (topic.post_text || "").trim();
    if (postText.length >= MIN_LENGTH) {
      items.push({
        text: postText,
        sourceType: SOURCE_TYPE,
        senderId: topic.post_user_id,
      });
    }

    for (const comment of topic.comments || []) {
      const commentText = (comment.comment_text || "").trim();
      if (commentText.length >= MIN_LENGTH) {
        items.push({
          text: commentText,
          sourceType: SOURCE_TYPE,
          senderId: comment.comment_user_id,
        });
      }
    }
  }

  return items;
}

async function main() {
  const raw = fs.readFileSync(filePath, "utf-8");
  const topics: NinisiteTopic[] = JSON.parse(raw);

  if (!Array.isArray(topics)) {
    console.error("File must contain a JSON array of topic objects");
    process.exit(1);
  }

  const items = buildItems(topics);
  console.log(`Loaded ${topics.length} topic(s) from ${filePath}`);
  console.log(`Prepared ${items.length} item(s) to import (posts + comments, min ${MIN_LENGTH} chars)`);

  const result = await submitBatch(items);

  console.log("\nDone.");
  console.log(`  Imported: ${result.imported}`);
  console.log(`  Skipped (duplicate): ${result.skippedDuplicate}`);
  console.log(`  Skipped (invalid length): ${result.skippedInvalid}`);
  if (result.errors.length > 0) {
    console.log(`  Errors: ${result.errors.length}`);
    result.errors.forEach((e) => console.log(`    - ${e}`));
  }
  console.log("\nRun `npm run worker` to process the imported items. This may take a while given the volume.");
}

main();

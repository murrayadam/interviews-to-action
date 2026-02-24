/**
 * CLI for interacting with Granola meetings directly.
 *
 * Usage:
 *   npx tsx src/cli.ts list                  # List recent meetings
 *   npx tsx src/cli.ts latest                # Process the most recent meeting
 *   npx tsx src/cli.ts process <title>       # Process a meeting by title search
 *   npx tsx src/cli.ts process --id <id>     # Process a meeting by ID
 *   npx tsx src/cli.ts reset                 # Reset processed state
 */
import { loadConfig } from "./config.js";
import { createGranolaClient } from "./granola.js";
import { processMeeting } from "./pipeline.js";
import { markProcessed, isProcessed, resetState } from "./state.js";

const loadDotenv = async () => {
  try {
    const { config } = await import("dotenv");
    config();
  } catch { }
};

const printUsage = () => {
  console.log(`
Granola Meeting Automator CLI

Usage:
  npx tsx src/cli.ts list                  List recent meetings
  npx tsx src/cli.ts latest                Process the most recent meeting
  npx tsx src/cli.ts process <title>       Process meeting matching title
  npx tsx src/cli.ts process --id <id>     Process meeting by Granola doc ID
  npx tsx src/cli.ts reset                 Reset processed state (re-process all)
`);
};

const main = async () => {
  await loadDotenv();
  const config = loadConfig();
  const granola = createGranolaClient(config.granolaDataDir);

  const [command, ...args] = process.argv.slice(2);

  if (!command || command === "--help" || command === "-h") {
    printUsage();
    return;
  }

  if (command === "reset") {
    resetState();
    return;
  }

  if (command === "list") {
    console.log("📋 Fetching recent meetings from Granola...\n");
    const docs = await granola.fetchDocuments(20);
    docs.forEach((doc, i) => {
      const date = new Date(doc.updated_at).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
      console.log(`  ${String(i + 1).padStart(2)}. ${doc.title}`);
      console.log(`      ${date}  |  ID: ${doc.id}`);
    });
    console.log(`\n  ${docs.length} meetings found.`);
    return;
  }

  if (command === "latest") {
    console.log("📋 Fetching latest meeting from Granola...\n");
    const docs = await granola.fetchDocuments(1);
    if (docs.length === 0) {
      console.log("No meetings found.");
      return;
    }
    const meeting = await granola.fetchMeeting(docs[0]);

    if (isProcessed(meeting.id)) {
      console.log(`⏭️  Already processed: "${meeting.title}". Use "reset" to re-process.`);
      return;
    }
    
    const result = await processMeeting(config, meeting);

    markProcessed(meeting.id);
    console.log("\n📊 Results:");
    console.log(`   Tickets: ${result.jiraTickets.map((t) => t.key).join(", ") || "none"}`);
    console.log(`   Action items: ${result.extraction.actionItems.length}`);
    return;
  }


  if (command === "process") {
    if (args[0] === "--id" && args[1]) {
      console.log(`📋 Fetching meeting ${args[1]}...\n`);
      const docs = await granola.fetchDocuments(100);
      const doc = docs.find((d) => d.id === args[1]);
      if (!doc) {
        console.error(`❌ Meeting with ID "${args[1]}" not found.`);
        process.exit(1);
      }
      const meeting = await granola.fetchMeeting(doc);

      if (isProcessed(meeting.id)) {
        console.log(`⏭️  Already processed: "${meeting.title}". Use "reset" to re-process.`);
        return;
      }

      await processMeeting(config, meeting);
      markProcessed(meeting.id);
      return;
    }

    const searchTerm = args.join(" ").toLowerCase();
    if (!searchTerm) {
      console.error("❌ Please provide a meeting title to search for.");
      printUsage();
      process.exit(1);
    }

    console.log(`🔍 Searching for meeting: "${searchTerm}"...\n`);
    const docs = await granola.fetchDocuments(100);
    const match = docs.find((d) => d.title.toLowerCase().includes(searchTerm));

    if (!match) {
      console.error(`❌ No meeting found matching "${searchTerm}".`);
      console.log("\nRecent meetings:");
      docs.slice(0, 5).forEach((d) => console.log(`  - ${d.title}`));
      process.exit(1);
    }

    console.log(`Found: "${match.title}"`);
    const meeting = await granola.fetchMeeting(match);
    await processMeeting(config, meeting);
    markProcessed(meeting.id);
    return;
  }

  console.error(`❌ Unknown command: ${command}`);
  printUsage();
  process.exit(1);
};

main().catch((err) => {
  console.error("❌ Fatal error:", err);
  process.exit(1);
});

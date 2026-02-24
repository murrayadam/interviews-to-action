import type { Config } from "./config.js";
import type { MeetingData, PipelineResult } from "./types.js";
import { extractMeetingData } from "./extract.js";
import { createJiraTickets } from "./jira.js";
import { postSlackSummary } from "./slack.js";

export const processMeeting = async (
  config: Config,
  meeting: MeetingData
): Promise<PipelineResult> => {
  console.log(`\n🚀 Processing: "${meeting.title}" (${meeting.id})`);

  // Step 1: Extract structured data
  console.log("📊 Extracting action items and tickets with Claude...");
  const extraction = await extractMeetingData(config.anthropicApiKey, meeting);
  console.log(
    `   Found: ${extraction.actionItems.length} action items, ` +
    `${extraction.engineeringTickets.length} engineering tickets, ` +
    `${extraction.keyDecisions.length} decisions`
  );

  // Step 2: Create JIRA tickets
  let jiraTickets: PipelineResult["jiraTickets"] = [];
  if (extraction.engineeringTickets.length > 0) {
    console.log("🎫 Creating JIRA tickets...");
    jiraTickets = await createJiraTickets(config, extraction.engineeringTickets);
  } else {
    console.log("🎫 No engineering tickets to create.");
  }

  // Step 3: Post to Slack
  console.log("💬 Posting summary to Slack...");
  const slackMessageTs = await postSlackSummary(config, meeting, extraction, jiraTickets);
  console.log(`   Posted to Slack (ts: ${slackMessageTs})`);

  console.log(`✅ Done processing "${meeting.title}"\n`);

  return {
    meetingId: meeting.id,
    meetingTitle: meeting.title,
    extraction,
    jiraTickets,
    slackMessageTs,
  };
};

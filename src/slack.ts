import { WebClient } from "@slack/web-api";
import type { Config } from "./config.js";
import type { MeetingData, MeetingExtraction, JiraTicketResult } from "./types.js";

const buildBlocks = (
  meeting: MeetingData,
  extraction: MeetingExtraction,
  jiraTickets: JiraTicketResult[],
  jiraBaseUrl: string
): object[] => {
  const blocks: object[] = [];

  // Header
  blocks.push({
    type: "header",
    text: { type: "plain_text", text: `📋 ${meeting.title}`, emoji: true },
  });

  // Meeting metadata
  const date = new Date(meeting.createdAt).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: `📅 ${date}` }],
  });

  blocks.push({ type: "divider" });

  // Summary
  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: `*Summary*\n${extraction.meetingSummary}` },
  });

  // Key decisions
  if (extraction.keyDecisions.length > 0) {
    const decisions = extraction.keyDecisions.map((d) => `• ${d}`).join("\n");
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*Key Decisions*\n${decisions}` },
    });
  }

  // Action items
  if (extraction.actionItems.length > 0) {
    const items = extraction.actionItems
      .map((item) => {
        const assignee = item.assignee ? ` → _${item.assignee}_` : "";
        const due = item.dueDate ? ` (due: ${item.dueDate})` : "";
        const icon = item.priority === "High" ? "🔴" : item.priority === "Medium" ? "🟡" : "🟢";
        return `${icon} ${item.description}${assignee}${due}`;
      })
      .join("\n");
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*Action Items*\n${items}` },
    });
  }

  // Engineering tickets
  if (jiraTickets.length > 0) {
    const ticketLines = jiraTickets
      .map((t) => `• <${jiraBaseUrl}/browse/${t.key}|${t.key}>: ${t.summary}`)
      .join("\n");
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*Engineering Tickets Created*\n${ticketLines}` },
    });
  }

  // Follow-ups
  if (extraction.followUps.length > 0) {
    const followUps = extraction.followUps.map((f) => `• ${f}`).join("\n");
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*Follow-ups*\n${followUps}` },
    });
  }

  return blocks;
};

export const postSlackSummary = async (
  config: Config,
  meeting: MeetingData,
  extraction: MeetingExtraction,
  jiraTickets: JiraTicketResult[]
): Promise<string> => {
  const slack = new WebClient(config.slackBotToken);

  const blocks = buildBlocks(meeting, extraction, jiraTickets, config.jiraBaseUrl);
  const ticketCount = jiraTickets.length;
  const actionCount = extraction.actionItems.length;

  const result = await slack.chat.postMessage({
    channel: config.slackChannelId,
    text: `📋 ${meeting.title} — ${ticketCount} tickets created, ${actionCount} action items`,
    blocks: blocks as any,
    unfurl_links: false,
  });

  return result.ts ?? "";
};

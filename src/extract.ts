import Anthropic from "@anthropic-ai/sdk";
import { meetingExtractionSchema, type MeetingData, type MeetingExtraction } from "./types.js";

const EXTRACTION_PROMPT = `You are a meeting analyst for an engineering team. Given meeting notes and transcript, extract structured data.

Rules:
- Engineering tickets should be concrete, well-scoped work items (not vague "look into X")
- Action items are non-engineering tasks: follow-ups, emails to send, meetings to schedule, decisions to communicate
- Infer priority from urgency cues in the conversation (blockers = High, nice-to-haves = Low)
- If someone is clearly assigned something, include their name as assignee
- Acceptance criteria should be testable statements
- Keep summaries concise but complete
- If no engineering tickets or action items are present, return empty arrays — don't invent work

Respond ONLY with a JSON object matching this schema (no markdown, no backticks):
{
  "meetingSummary": "string — 2-3 sentence summary of the meeting",
  "keyDecisions": ["string — decisions that were made"],
  "actionItems": [
    {
      "description": "string — what needs to be done",
      "assignee": "string | null — who is responsible",
      "dueDate": "string | null — any mentioned deadline",
      "priority": "High | Medium | Low"
    }
  ],
  "engineeringTickets": [
    {
      "summary": "string — ticket title, concise and descriptive",
      "description": "string — detailed description with context from the meeting",
      "issueType": "Bug | Story | Task | Spike",
      "priority": "Highest | High | Medium | Low | Lowest",
      "acceptanceCriteria": ["string — testable acceptance criteria"],
      "assignee": "string | null"
    }
  ],
  "followUps": ["string — items to revisit or discuss later"]
}`;

const buildMeetingContext = (meeting: MeetingData): string => {
  const parts: string[] = [
    `Meeting: ${meeting.title}`,
    `Date: ${meeting.createdAt}`,
    "---",
  ];

  if (meeting.notesMarkdown) {
    parts.push(`## Enhanced Notes\n${meeting.notesMarkdown}`);
  }

  if (meeting.transcript) {
    parts.push(`## Transcript\n${meeting.transcript}`);
  }

  return parts.join("\n\n");
};

export const extractMeetingData = async (
  apiKey: string,
  meeting: MeetingData
): Promise<MeetingExtraction> => {
  const client = new Anthropic({ apiKey });
  const meetingContext = buildMeetingContext(meeting);

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: `${EXTRACTION_PROMPT}\n\n---\n\nHere are the meeting notes to analyze:\n\n${meetingContext}`,
      },
    ],
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

  const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  const parsed = JSON.parse(cleaned);
  return meetingExtractionSchema.parse(parsed);
};

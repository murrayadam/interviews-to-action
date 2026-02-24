import { z } from "zod";

// ── Granola API response types ─────────────────────────────────────

export interface GranolaProseMirrorNode {
  type: string;
  content?: GranolaProseMirrorNode[];
  text?: string;
  attrs?: Record<string, unknown>;
}

export interface GranolaDocument {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  workspace_id?: string;
  last_viewed_panel?: {
    content?: GranolaProseMirrorNode;
  };
}

export interface GranolaTranscriptUtterance {
  source: "microphone" | "system";
  text: string;
  start_timestamp: string;
  end_timestamp: string;
  confidence: number;
}

// ── Normalized meeting data (what we feed to Claude) ───────────────

export interface MeetingData {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  notesMarkdown: string;
  transcript: string;
}

// ── Claude extraction output ───────────────────────────────────────

export const actionItemSchema = z.object({
  description: z.string(),
  assignee: z.string().nullish(),
  dueDate: z.string().nullish(),
  priority: z.enum(["High", "Medium", "Low"]).default("Medium"),
});

export const engineeringTicketSchema = z.object({
  summary: z.string(),
  description: z.string(),
  issueType: z.enum(["Bug", "Story", "Task", "Spike"]).default("Task"),
  priority: z.enum(["Highest", "High", "Medium", "Low", "Lowest"]).default("Medium"),
  acceptanceCriteria: z.array(z.string()).nullish(),
  assignee: z.string().nullish(),
});

export const meetingExtractionSchema = z.object({
  meetingSummary: z.string(),
  keyDecisions: z.array(z.string()),
  actionItems: z.array(actionItemSchema),
  engineeringTickets: z.array(engineeringTicketSchema),
  followUps: z.array(z.string()),
});

export type ActionItem = z.infer<typeof actionItemSchema>;
export type EngineeringTicket = z.infer<typeof engineeringTicketSchema>;
export type MeetingExtraction = z.infer<typeof meetingExtractionSchema>;

// ── JIRA response ──────────────────────────────────────────────────

export interface JiraTicketResult {
  key: string;
  id: string;
  self: string;
  summary: string;
}

// ── Pipeline result ────────────────────────────────────────────────

export interface PipelineResult {
  meetingId: string;
  meetingTitle: string;
  extraction: MeetingExtraction;
  jiraTickets: JiraTicketResult[];
  slackMessageTs: string;
}

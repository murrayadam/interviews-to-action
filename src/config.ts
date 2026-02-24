import { z } from "zod";
import { homedir, platform } from "os";
import { join } from "path";

const getDefaultGranolaDir = (): string => {
  const os = platform();
  if (os === "darwin") return join(homedir(), "Library", "Application Support", "Granola");
  if (os === "win32") return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "Granola");
  // Linux fallback — unlikely but handle gracefully
  return join(homedir(), ".granola");
};

const envSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1),
  JIRA_BASE_URL: z.string().url(),
  JIRA_EMAIL: z.string().email(),
  JIRA_API_TOKEN: z.string().min(1),
  JIRA_POD: z.string().min(1),
  JIRA_PROJECT_KEY: z.string().min(1).default("ENG"),
  SLACK_BOT_TOKEN: z.string().startsWith("xoxb-"),
  SLACK_CHANNEL_ID: z.string().min(1),
  GRANOLA_DATA_DIR: z.string().optional(),

  // How many minutes after a meeting ends to trigger processing.
  // Gives Granola time to generate enhanced notes. Default: 5 min.
  DELAY_AFTER_MEETING_MINUTES: z.coerce.number().min(1).default(5),

  // How often (minutes) to re-fetch today's calendar for new meetings.
  CALENDAR_REFRESH_MINUTES: z.coerce.number().min(5).default(30),
});

export interface Config {
  anthropicApiKey: string;
  jiraBaseUrl: string;
  jiraEmail: string;
  jiraApiToken: string;
  jiraPod: string;
  jiraProjectKey: string;
  slackBotToken: string;
  slackChannelId: string;
  granolaDataDir: string;
  delayAfterMeetingMs: number;
  calendarRefreshMs: number;
}

export const loadConfig = (): Config => {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const missing = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    console.error(`\n❌ Missing or invalid environment variables:\n${missing}\n`);
    console.error("Copy .env.example to .env and fill in your values.\n");
    process.exit(1);
  }

  const env = result.data;

  return {
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    jiraBaseUrl: env.JIRA_BASE_URL,
    jiraEmail: env.JIRA_EMAIL,
    jiraApiToken: env.JIRA_API_TOKEN,
    jiraPod: env.JIRA_POD,
    jiraProjectKey: env.JIRA_PROJECT_KEY,
    slackBotToken: env.SLACK_BOT_TOKEN,
    slackChannelId: env.SLACK_CHANNEL_ID,
    granolaDataDir: env.GRANOLA_DATA_DIR || getDefaultGranolaDir(),
    delayAfterMeetingMs: env.DELAY_AFTER_MEETING_MINUTES * 60 * 1000,
    calendarRefreshMs: env.CALENDAR_REFRESH_MINUTES * 60 * 1000,
  };
};

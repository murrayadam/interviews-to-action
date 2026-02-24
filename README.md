# Granola → JIRA + Slack Meeting Automator

Automatically create JIRA engineering tickets and post Slack summaries from your Granola meeting notes — triggered by your calendar, runs entirely on your machine.

## How It Works

```
macOS Calendar.app (synced with Google Calendar)
  │
  ▼
Scheduler reads today's events from local SQLite DB:
  "Sprint Planning ends 2:00 PM → process at 2:05 PM"
  │
  ▼
5 min after meeting ends:
  │
  ├─ Reads Granola's local API for notes + transcript
  │
  ├─ Claude extracts:
  │   • Meeting summary & key decisions
  │   • Action items
  │   • Engineering tickets (with acceptance criteria)
  │   • Follow-ups
  │
  ├─ JIRA creates tickets
  │
  └─ Slack posts summary with ticket links
```

**No Zapier. No webhooks. No Google API keys.** Calendar events are read directly from the macOS Calendar SQLite database. Granola notes are read from Granola's local auth token. The only API calls are to Claude (extraction), JIRA (tickets), and Slack (notification).

## Setup

### 1. Install

```bash
npm install
cp .env.example .env
```

### 2. Configure `.env`

You only need three sets of credentials:

**Anthropic:** API key from [console.anthropic.com](https://console.anthropic.com)

**JIRA:**
- `JIRA_BASE_URL` → `https://your-org.atlassian.net`
- `JIRA_EMAIL` → your Atlassian email
- `JIRA_API_TOKEN` → create at [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens)

**Slack:**
- Create a Slack app at [api.slack.com/apps](https://api.slack.com/apps)
- Bot Token Scopes: `chat:write`, `chat:write.public`
- Install to workspace, copy the `xoxb-...` token

### 3. Prerequisites

- **Granola** installed and signed in
- **macOS Calendar.app** synced with your Google Calendar (System Settings → Internet Accounts → Google)
- First launch may require granting Terminal/iTerm **Full Disk Access** in System Settings → Privacy & Security (needed to read the Calendar database)

### 4. Verify

```bash
# Check Granola connection
npx tsx src/cli.ts list

# Start scheduler (prints today's events on launch)
npm run scheduler
```

### 5. Run

```bash
npm run scheduler
```

That's it. The scheduler reads your calendar, computes when each meeting ends, and fires processing 5 minutes later.

## CLI

```bash
npx tsx src/cli.ts list                  # List recent Granola meetings
npx tsx src/cli.ts latest                # Process the most recent meeting
npx tsx src/cli.ts process "standup"     # Process by title search
npx tsx src/cli.ts process --id <id>     # Process by Granola doc ID
npx tsx src/cli.ts reset                 # Reset state (re-process all)
```

## Run on Startup (macOS)

Create `~/Library/LaunchAgents/com.granola-automator.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.granola-automator</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/path/to/dist/scheduler.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>/path/to/granola-meeting-automator</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/granola-automator.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/granola-automator.err</string>
</dict>
</plist>
```

```bash
npm run build
launchctl load ~/Library/LaunchAgents/com.granola-automator.plist
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `DELAY_AFTER_MEETING_MINUTES` | `5` | Minutes after meeting ends to trigger processing |
| `CALENDAR_REFRESH_MINUTES` | `30` | How often to re-check calendar for new meetings |

## How Calendar + Granola Matching Works

When a meeting ends, the scheduler finds the corresponding Granola document using:

1. **Title + time match:** Granola docs whose title matches the calendar event, created within ±2 hours
2. **Time proximity fallback:** Closest Granola doc created within ±30 minutes (handles renamed meetings)
3. **Retry:** If no notes exist yet, retries once after 2 more minutes

## How Local Auth Works

**Calendar:** Reads `~/Library/Group Containers/group.com.apple.calendar/Calendar.sqlitedb` directly via `sqlite3` (pre-installed on macOS). Your Google Calendar events are here because macOS Calendar syncs them locally.

**Granola:** Reads the WorkOS auth token from `~/Library/Application Support/Granola/supabase.json` — the same approach used by the [Raycast Granola extension](https://www.raycast.com/Rob/granola).

## Architecture

```
src/
├── config.ts       Env validation, OS-aware paths
├── types.ts        Shared types & Zod schemas
├── calendar.ts     macOS Calendar SQLite reader (zero API keys)
├── granola.ts      Granola private API client (local auth)
├── extract.ts      Claude API for meeting analysis
├── jira.ts         JIRA REST API ticket creation
├── slack.ts        Slack Block Kit message builder
├── pipeline.ts     Orchestrates extract → JIRA → Slack
├── state.ts        Dedup tracking (persisted to disk)
├── scheduler.ts    Calendar-driven scheduling engine
└── cli.ts          Manual CLI operations
```

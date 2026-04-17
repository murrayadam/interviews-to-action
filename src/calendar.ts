/**
 * Reads calendar events directly from the macOS Calendar SQLite database.
 * No API keys, no OAuth, no network calls.
 *
 * The database lives at:
 *   ~/Library/Group Containers/group.com.apple.calendar/Calendar.sqlitedb
 *   (fallback: ~/Library/Calendars/Calendar.sqlitedb)
 *
 * Core Data stores dates as seconds since Jan 1, 2001 (the "Apple epoch").
 * We convert to JS Date objects by adding the offset.
 */
import { execSync } from "child_process";
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export interface CalendarEvent {
  id: string;
  summary: string;
  start: Date;
  end: Date;
  calendarName: string;
}

// Apple epoch: Jan 1, 2001 00:00:00 UTC — offset from Unix epoch in seconds
const APPLE_EPOCH_OFFSET = 978307200;

const toJsDate = (appleTimestamp: number): Date =>
  new Date((appleTimestamp + APPLE_EPOCH_OFFSET) * 1000);

const getDbPath = (): string => {
  const paths = [
    join(homedir(), "Library", "Group Containers", "group.com.apple.calendar", "Calendar.sqlitedb"),
    join(homedir(), "Library", "Calendars", "Calendar.sqlitedb"),
  ];

  const found = paths.find(existsSync);
  if (!found) {
    throw new Error(
      `macOS Calendar database not found. Checked:\n` +
      paths.map((p) => `  - ${p}`).join("\n") +
      `\n\nMake sure Calendar.app is set up and has synced at least once.`
    );
  }

  return found;
};

const runQuery = (dbPath: string, sql: string): string => {
  // Escape double quotes in SQL for shell safety
  const escaped = sql.replace(/"/g, '\\"');
  return execSync(
    `sqlite3 -json "${dbPath}" "${escaped}"`,
    { encoding: "utf-8", timeout: 5000 }
  ).trim();
};

const parseRows = (raw: string): CalendarEvent[] => {
  if (!raw) return [];

  const rows = JSON.parse(raw) as Array<{
    ROWID: number;
    summary: string;
    start_date: number;
    end_date: number;
    title: string | null;
  }>;

  return rows.map((row) => ({
    id: String(row.ROWID),
    summary: row.summary,
    start: toJsDate(row.start_date),
    end: toJsDate(row.end_date),
    calendarName: row.title ?? "Unknown",
  }));
};

/**
 * Query the local macOS Calendar database for today's timed events.
 * Uses sqlite3 CLI (pre-installed on macOS) to avoid native module dependencies.
 */
export const fetchTodaysEvents = async (): Promise<CalendarEvent[]> => {
  const dbPath = getDbPath();

  // Build date boundaries for today in Apple epoch seconds
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

  const startApple = Math.floor(startOfDay.getTime() / 1000) - APPLE_EPOCH_OFFSET;
  const endApple = Math.floor(endOfDay.getTime() / 1000) - APPLE_EPOCH_OFFSET;

  // SQL: join CalendarItem with Calendar to get the calendar name.
  // Filter for timed events today (exclude all-day where start == end of day).
  const sql = `
    SELECT
      ci.ROWID,
      ci.summary,
      ci.start_date,
      ci.end_date,
      c.title
    FROM CalendarItem ci
    LEFT JOIN Calendar c ON ci.calendar_id = c.ROWID
    WHERE ci.start_date >= ${startApple}
      AND ci.start_date < ${endApple}
      AND ci.start_date != ci.end_date
      AND ci.summary IS NOT NULL
    ORDER BY ci.start_date ASC;
  `.trim();

  try {
    return parseRows(runQuery(dbPath, sql));
  } catch {
    // sqlite3 might fail if the database is locked by Calendar.app
    // Fall back to copying the db first
    const tmpDb = "/tmp/granola-automator-cal-cache.sqlitedb";
    try {
      execSync(`cp "${dbPath}" "${tmpDb}"`, { timeout: 3000 });
      return parseRows(runQuery(tmpDb, sql));
    } catch (fallbackErr) {
      console.error("❌ Failed to read macOS Calendar database:", fallbackErr);
      return [];
    }
  }
};

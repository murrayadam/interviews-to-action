import { loadConfig } from "./config.js";
import { fetchTodaysEvents, type CalendarEvent } from "./calendar.js";
import { createGranolaClient } from "./granola.js";
import { processMeeting } from "./pipeline.js";
import { isProcessed, markProcessed } from "./state.js";
import type { Config } from "./config.js";
import type { GranolaClient } from "./granola.js";

const loadDotenv = async () => {
  try {
    const { config } = await import("dotenv");
    config();
  } catch {}
};

// Tracks active timers so we don't double-schedule
const scheduledEventIds = new Set<string>();

const formatTime = (date: Date): string =>
  date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

const scheduleProcessing = (
  config: Config,
  granola: GranolaClient,
  event: CalendarEvent,
): void => {
  if (scheduledEventIds.has(event.id)) return;
  if (isProcessed(event.id)) {
    console.log(`   ⏭️  Already processed: "${event.summary}"`);
    return;
  }

  const triggerAt = new Date(event.end.getTime() + config.delayAfterMeetingMs);
  const delayMs = triggerAt.getTime() - Date.now();

  // If the trigger time is already past, fire soon (give 30s buffer)
  // This handles meetings that ended while the app wasn't running
  const effectiveDelay = Math.max(delayMs, 30_000);
  const fireAt = new Date(Date.now() + effectiveDelay);

  scheduledEventIds.add(event.id);

  console.log(
    `   ⏰ "${event.summary}" ends ${formatTime(event.end)} → ` +
    `processing at ${formatTime(fireAt)}`
  );

  setTimeout(async () => {
    console.log(`\n🔔 Meeting ended: "${event.summary}" — searching Granola for notes...`);

    try {
      // Find the matching Granola document
      // Strategy: fetch recent docs and match by title + time proximity
      const docs = await granola.fetchDocuments(20);
      const matchingDoc = findMatchingDoc(docs, event);

      if (!matchingDoc) {
        console.log(`   ⚠️  No Granola notes found for "${event.summary}". Skipping.`);
        // Don't mark as processed — might appear later
        scheduledEventIds.delete(event.id);
        return;
      }

      if (isProcessed(matchingDoc.id)) {
        console.log(`   ⏭️  Granola doc already processed: ${matchingDoc.id}`);
        markProcessed(event.id); // mark calendar event too
        return;
      }

      const meeting = await granola.fetchMeeting(matchingDoc);

      // Skip if Granola hasn't generated notes yet
      if (!meeting.notesMarkdown && !meeting.transcript) {
        console.log(`   ⚠️  Notes not ready yet for "${event.summary}". Will retry in 2 minutes.`);
        scheduledEventIds.delete(event.id);
        // Retry once after 2 more minutes
        setTimeout(() => {
          scheduledEventIds.delete(event.id);
          scheduleProcessing(config, granola, {
            ...event,
            end: new Date(), // pretend it just ended so delay kicks in again
          });
        }, 2 * 60 * 1000);
        return;
      }

      await processMeeting(config, meeting);
      markProcessed(event.id);
      markProcessed(matchingDoc.id);
    } catch (err) {
      console.error(`   ❌ Failed to process "${event.summary}":`, err);
      scheduledEventIds.delete(event.id);
    }
  }, effectiveDelay);
};

const findMatchingDoc = (
  docs: Array<{ id: string; title: string; created_at: string; updated_at: string }>,
  event: CalendarEvent,
): typeof docs[number] | undefined => {
  const eventTitle = event.summary.toLowerCase().trim();
  const eventStart = event.start.getTime();

  // First try: exact or close title match within ±2 hours of event time
  const titleMatches = docs.filter((doc) => {
    const docTitle = doc.title.toLowerCase().trim();
    const docTime = new Date(doc.created_at).getTime();
    const timeDiff = Math.abs(docTime - eventStart);
    const withinWindow = timeDiff < 2 * 60 * 60 * 1000; // 2 hours

    // Exact match, contains match, or starts-with match
    return withinWindow && (
      docTitle === eventTitle ||
      docTitle.includes(eventTitle) ||
      eventTitle.includes(docTitle)
    );
  });

  if (titleMatches.length > 0) {
    // Return the one closest in time
    return titleMatches.sort((a, b) => {
      const diffA = Math.abs(new Date(a.created_at).getTime() - eventStart);
      const diffB = Math.abs(new Date(b.created_at).getTime() - eventStart);
      return diffA - diffB;
    })[0];
  }

  // Fallback: closest doc by time within ±30 minutes (for renamed meetings)
  const timeMatches = docs
    .filter((doc) => {
      const docTime = new Date(doc.created_at).getTime();
      return Math.abs(docTime - eventStart) < 30 * 60 * 1000;
    })
    .sort((a, b) => {
      const diffA = Math.abs(new Date(a.created_at).getTime() - eventStart);
      const diffB = Math.abs(new Date(b.created_at).getTime() - eventStart);
      return diffA - diffB;
    });

  return timeMatches[0];
};

const refreshSchedule = async (config: Config, granola: GranolaClient): Promise<void> => {
  try {
    console.log(`\n📅 Fetching today's calendar... (${new Date().toLocaleTimeString()})`);
    const events = await fetchTodaysEvents();

    if (events.length === 0) {
      console.log("   No meetings on the calendar today.");
      return;
    }

    console.log(`   Found ${events.length} meeting(s) today:`);

    const now = Date.now();
    for (const event of events) {
      const isPast = event.end.getTime() < now;
      const status = isPast ? "(ended)" : `(ends ${formatTime(event.end)})`;
      console.log(`   • ${event.summary} ${formatTime(event.start)}–${formatTime(event.end)} ${status}`);

      // Schedule processing for meetings that have a future trigger time
      // or recently ended ones we haven't processed yet
      scheduleProcessing(config, granola, event);
    }
  } catch (err) {
    console.error("❌ Calendar refresh failed:", err);
  }
};

const main = async () => {
  await loadDotenv();
  const config = loadConfig();
  const granola = createGranolaClient(config.granolaDataDir);

  const delayMin = config.delayAfterMeetingMs / 60_000;
  const refreshMin = config.calendarRefreshMs / 60_000;

  console.log(`\n🟢 Granola Meeting Automator (calendar-driven)`);
  console.log(`   Granola data: ${config.granolaDataDir}`);
  console.log(`   JIRA project: ${config.jiraProjectKey}`);
  console.log(`   Process ${delayMin} min after meeting ends`);
  console.log(`   Calendar refresh every ${refreshMin} min`);

  // Initial schedule
  await refreshSchedule(config, granola);

  // Re-fetch calendar periodically to pick up new/changed meetings
  setInterval(() => refreshSchedule(config, granola), config.calendarRefreshMs);
};

main().catch((err) => {
  console.error("❌ Fatal error:", err);
  process.exit(1);
});

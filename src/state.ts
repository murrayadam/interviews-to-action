import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const STATE_FILE = join(
  process.env.HOME ?? process.env.USERPROFILE ?? ".",
  ".granola-automator-state.json"
);

interface State {
  processedIds: string[];
  lastPollAt: string;
}

const readState = (): State => {
  if (!existsSync(STATE_FILE)) {
    return { processedIds: [], lastPollAt: new Date(0).toISOString() };
  }

  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
  } catch {
    return { processedIds: [], lastPollAt: new Date(0).toISOString() };
  }
};

const writeState = (state: State): void => {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
};

export const isProcessed = (meetingId: string): boolean => {
  const state = readState();
  return state.processedIds.includes(meetingId);
};

export const markProcessed = (meetingId: string): void => {
  const state = readState();
  if (!state.processedIds.includes(meetingId)) {
    state.processedIds.push(meetingId);
    // Keep only last 500 IDs to avoid unbounded growth
    if (state.processedIds.length > 500) {
      state.processedIds = state.processedIds.slice(-500);
    }
    state.lastPollAt = new Date().toISOString();
    writeState(state);
  }
};

export const getLastPollTime = (): Date => {
  const state = readState();
  return new Date(state.lastPollAt);
};

export const resetState = (): void => {
  writeState({ processedIds: [], lastPollAt: new Date(0).toISOString() });
  console.log("🔄 State reset. All meetings will be re-evaluated on next poll.");
};

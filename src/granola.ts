import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import type {
  GranolaDocument,
  GranolaTranscriptUtterance,
  GranolaProseMirrorNode,
  MeetingData,
} from "./types.js";

const GRANOLA_API = "https://api.granola.ai";
const WORKOS_AUTH_URL = "https://api.workos.com/user_management/authenticate";
const USER_AGENT = "Granola/5.354.0";
const CLIENT_VERSION = "5.354.0";

interface TokenState {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

// ── Token management ───────────────────────────────────────────────

const readLocalTokens = (granolaDir: string): { accessToken: string; refreshToken: string; clientId: string } => {
  const supabasePath = join(granolaDir, "supabase.json");
  if (!existsSync(supabasePath)) {
    throw new Error(
      `Granola credentials not found at ${supabasePath}.\n` +
      `Make sure Granola is installed and you're logged in.`
    );
  }

  const raw = JSON.parse(readFileSync(supabasePath, "utf-8"));
  const workosTokens = typeof raw.workos_tokens === "string"
    ? JSON.parse(raw.workos_tokens)
    : raw.workos_tokens;

  const accessToken = workosTokens?.access_token;
  const refreshToken = workosTokens?.refresh_token;
  const clientId = workosTokens?.client_id ?? raw.client_id ?? "client_01JBVK2S4GBE0SDQF2MPF3VVR6";

  if (!accessToken) {
    throw new Error("No access_token found in Granola credentials. Try re-launching Granola and signing in.");
  }

  return { accessToken, refreshToken, clientId };
};

const refreshAccessToken = async (
  refreshToken: string,
  clientId: string
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> => {
  const response = await fetch(WORKOS_AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`WorkOS token refresh failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
  };
};

// ── ProseMirror → Markdown ─────────────────────────────────────────

const proseMirrorToMarkdown = (node: GranolaProseMirrorNode): string => {
  if (!node) return "";

  const childText = (n: GranolaProseMirrorNode): string =>
    (n.content ?? []).map(proseMirrorToMarkdown).join("");

  switch (node.type) {
    case "doc":
      return childText(node);
    case "heading": {
      const level = (node.attrs?.level as number) ?? 1;
      return `${"#".repeat(level)} ${childText(node)}\n\n`;
    }
    case "paragraph":
      return `${childText(node)}\n\n`;
    case "bulletList":
      return (node.content ?? [])
        .map((item) => {
          const content = childText(item).trim();
          return `- ${content}`;
        })
        .join("\n") + "\n\n";
    case "orderedList":
      return (node.content ?? [])
        .map((item, i) => {
          const content = childText(item).trim();
          return `${i + 1}. ${content}`;
        })
        .join("\n") + "\n\n";
    case "listItem":
      return childText(node);
    case "text":
      return node.text ?? "";
    case "hardBreak":
      return "\n";
    default:
      return childText(node);
  }
};

// ── Transcript formatting ──────────────────────────────────────────

const formatTranscript = (utterances: GranolaTranscriptUtterance[]): string =>
  utterances
    .map((u) => {
      const time = new Date(u.start_timestamp).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      });
      const source = u.source === "microphone" ? "You" : "Other";
      return `[${time}] ${source}: ${u.text}`;
    })
    .join("\n");

// ── Granola API client ─────────────────────────────────────────────

export const createGranolaClient = (granolaDir: string) => {
  let tokenState: TokenState | null = null;
  let clientId: string;

  const ensureToken = async (): Promise<string> => {
    // If we have a valid (non-expired) access token, use it
    if (tokenState && Date.now() < tokenState.expiresAt - 60_000) {
      return tokenState.accessToken;
    }

    // If we have a refresh token, try refreshing
    if (tokenState?.refreshToken) {
      try {
        const refreshed = await refreshAccessToken(tokenState.refreshToken, clientId);
        tokenState = {
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken,
          expiresAt: Date.now() + refreshed.expiresIn * 1000,
        };
        return tokenState.accessToken;
      } catch (err) {
        console.warn("⚠️  Token refresh failed, falling back to local credentials:", err);
      }
    }

    // Fall back to reading fresh tokens from disk
    const local = readLocalTokens(granolaDir);
    clientId = local.clientId;
    tokenState = {
      accessToken: local.accessToken,
      refreshToken: local.refreshToken,
      expiresAt: Date.now() + 3600 * 1000, // assume 1h validity
    };
    return tokenState.accessToken;
  };

  const granolaFetch = async (path: string, body: object = {}): Promise<Response> => {
    const token = await ensureToken();
    return fetch(`${GRANOLA_API}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "*/*",
        "User-Agent": USER_AGENT,
        "X-Client-Version": CLIENT_VERSION,
      },
      body: JSON.stringify(body),
    });
  };

  const fetchDocuments = async (limit = 100, offset = 0): Promise<GranolaDocument[]> => {
    const response = await granolaFetch("/v2/get-documents", {
      limit,
      offset,
      include_last_viewed_panel: true,
    });

    if (!response.ok) {
      throw new Error(`Granola API error (${response.status}): ${await response.text()}`);
    }

    const data = (await response.json()) as { docs: GranolaDocument[] };
    return data.docs ?? [];
  };

  const fetchTranscript = async (documentId: string): Promise<GranolaTranscriptUtterance[]> => {
    const response = await granolaFetch("/v1/get-document-transcript", {
      document_id: documentId,
    });

    if (response.status === 404) return [];
    if (!response.ok) {
      console.warn(`⚠️  Failed to fetch transcript for ${documentId}: ${response.status}`);
      return [];
    }

    const data = await response.json();
    return Array.isArray(data) ? data : [];
  };

  const fetchMeeting = async (doc: GranolaDocument): Promise<MeetingData> => {
    const notesMarkdown = doc.last_viewed_panel?.content
      ? proseMirrorToMarkdown(doc.last_viewed_panel.content).trim()
      : "";

    const utterances = await fetchTranscript(doc.id);
    const transcript = formatTranscript(utterances);

    return {
      id: doc.id,
      title: doc.title,
      createdAt: doc.created_at,
      updatedAt: doc.updated_at,
      notesMarkdown,
      transcript,
    };
  };

  const fetchNewMeetings = async (since: Date): Promise<MeetingData[]> => {
    const docs = await fetchDocuments();
    const newDocs = docs.filter((d) => new Date(d.updated_at) > since);

    if (newDocs.length === 0) return [];

    const meetings: MeetingData[] = [];
    for (const doc of newDocs) {
      meetings.push(await fetchMeeting(doc));
    }
    return meetings;
  };

  return { fetchDocuments, fetchTranscript, fetchMeeting, fetchNewMeetings };
};

export type GranolaClient = ReturnType<typeof createGranolaClient>;

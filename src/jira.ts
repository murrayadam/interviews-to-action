import type { Config } from "./config.js";
import type { EngineeringTicket, JiraTicketResult } from "./types.js";

const buildAuthHeader = (email: string, token: string): string =>
  `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`;

const jiraFetch = async (
  config: Config,
  path: string,
  options: RequestInit = {}
): Promise<Response> => {
  const url = `${config.jiraBaseUrl}/rest/api/3${path}`;
  return fetch(url, {
    ...options,
    headers: {
      Authorization: buildAuthHeader(config.jiraEmail, config.jiraApiToken),
      "Content-Type": "application/json",
      Accept: "application/json",
      ...options.headers,
    },
  });
};

const formatDescription = (ticket: EngineeringTicket): object => ({
  type: "doc",
  version: 1,
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: ticket.description }],
    },
    ...(ticket.acceptanceCriteria?.length
      ? [
          {
            type: "heading",
            attrs: { level: 3 },
            content: [{ type: "text", text: "Acceptance Criteria" }],
          },
          {
            type: "bulletList",
            content: ticket.acceptanceCriteria.map((ac) => ({
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: ac }],
                },
              ],
            })),
          },
        ]
      : []),
  ],
});

export const createJiraTicket = async (
  config: Config,
  ticket: EngineeringTicket
): Promise<JiraTicketResult> => {
  const body = {
    fields: {
      project: { key: config.jiraProjectKey },
      summary: ticket.summary,
      description: formatDescription(ticket),
      issuetype: { name: ticket.issueType === "Spike" ? "Task" : ticket.issueType },
      customfield_10089: [{ value: config.jiraPod }],
      priority: { name: ticket.priority },
      ...(ticket.issueType === "Spike" ? { labels: ["spike"] } : {}),
    },
  };

  const response = await jiraFetch(config, "/issue", {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`JIRA API error (${response.status}): ${error}`);
  }

  const data = (await response.json()) as { key: string; id: string; self: string };
  return { key: data.key, id: data.id, self: data.self, summary: ticket.summary };
};

export const createJiraTickets = async (
  config: Config,
  tickets: EngineeringTicket[]
): Promise<JiraTicketResult[]> => {
  const results: JiraTicketResult[] = [];

  for (const ticket of tickets) {
    try {
      const result = await createJiraTicket(config, ticket);
      console.log(`  ✅ Created ${result.key}: ${result.summary}`);
      results.push(result);
    } catch (err) {
      console.error(`  ❌ Failed to create ticket "${ticket.summary}":`, err);
    }
  }

  return results;
};

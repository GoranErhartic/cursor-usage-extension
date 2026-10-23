import { buildSessionCookieValue } from "./jwt";

const USAGE_URL = "https://cursor.com/api/usage-summary";
const FETCH_TIMEOUT_MS = 30_000;

export interface UsageOverall {
  enabled: boolean;
  used: number;
  limit: number;
  remaining: number;
}

export interface UsageSummary {
  overall: UsageOverall;
  billingCycleStart?: string;
  billingCycleEnd?: string;
}

export type UsageFetchErrorCode =
  | "no-token"
  | "unauthorized"
  | "network"
  | "bad-response";

export class UsageFetchError extends Error {
  constructor(
    message: string,
    readonly code: UsageFetchErrorCode,
  ) {
    super(message);
    this.name = "UsageFetchError";
  }
}

function parseOverall(body: unknown): UsageOverall {
  if (!body || typeof body !== "object") {
    throw new UsageFetchError("Invalid usage response.", "bad-response");
  }
  const record = body as {
    overall?: unknown;
    individualUsage?: { overall?: unknown };
  };
  const overall = record.individualUsage?.overall ?? record.overall;
  if (!overall || typeof overall !== "object") {
    throw new UsageFetchError("Missing overall usage in response.", "bad-response");
  }
  const o = overall as Record<string, unknown>;
  const enabled = o.enabled;
  const used = o.used;
  const limit = o.limit;
  const remaining = o.remaining;
  if (
    typeof enabled !== "boolean" ||
    typeof used !== "number" ||
    typeof limit !== "number" ||
    typeof remaining !== "number"
  ) {
    throw new UsageFetchError("Unexpected usage field types.", "bad-response");
  }
  return { enabled, used, limit, remaining };
}

async function fetchWithCookie(cookieValue: string): Promise<Response> {
  return fetch(USAGE_URL, {
    method: "GET",
    headers: {
      Cookie: `WorkosCursorSessionToken=${cookieValue}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
}

export async function fetchUsageSummary(accessToken: string): Promise<UsageSummary> {
  if (!accessToken) {
    throw new UsageFetchError("Not signed in to Cursor.", "no-token");
  }

  const cookieValue = buildSessionCookieValue(accessToken);
  if (!cookieValue) {
    throw new UsageFetchError("Could not derive session from access token.", "no-token");
  }

  let response: Response;
  try {
    response = await fetchWithCookie(cookieValue);
  } catch {
    throw new UsageFetchError("Network error fetching usage.", "network");
  }

  if (
    (response.status === 401 || response.status === 403) &&
    cookieValue !== accessToken
  ) {
    try {
      response = await fetchWithCookie(accessToken);
    } catch {
      throw new UsageFetchError("Network error fetching usage.", "network");
    }
  }

  if (response.status === 401 || response.status === 403) {
    throw new UsageFetchError("Session expired or unauthorized.", "unauthorized");
  }

  if (!response.ok) {
    throw new UsageFetchError(`Usage API returned ${response.status}.`, "bad-response");
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new UsageFetchError("Could not parse usage response.", "bad-response");
  }

  const record = body as {
    billingCycleStart?: unknown;
    billingCycleEnd?: unknown;
  };
  const summary: UsageSummary = { overall: parseOverall(body) };
  if (typeof record.billingCycleStart === "string") {
    summary.billingCycleStart = record.billingCycleStart;
  }
  if (typeof record.billingCycleEnd === "string") {
    summary.billingCycleEnd = record.billingCycleEnd;
  }
  return summary;
}

export function usageErrorFromCode(code: UsageFetchErrorCode): string {
  switch (code) {
    case "no-token":
      return "Sign in to Cursor to see usage.";
    case "unauthorized":
      return "Session expired. Sign in again in Cursor.";
    case "network":
      return "Could not reach Cursor usage API.";
    case "bad-response":
      return "Unexpected response from usage API.";
    default:
      return "Failed to load usage.";
  }
}

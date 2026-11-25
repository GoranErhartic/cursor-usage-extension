import type { RefreshResult, Tokens } from "./browserLogin";
import { UsageFetchError, type UsageSummary } from "./usageApi";

export interface UsageDeps {
  tokens: Tokens;
  fetchUsage: (accessToken: string) => Promise<UsageSummary>;
  refresh: (refreshToken: string) => Promise<RefreshResult>;
  save: (tokens: Tokens) => Promise<void>;
  clear: () => Promise<void>;
}

/**
 * Fetches usage; on `unauthorized` refreshes the session once and retries once.
 * A rejected session clears the tokens and throws `no-token` (sign in again).
 */
export async function fetchUsageWithRefresh(deps: UsageDeps): Promise<UsageSummary> {
  try {
    return await deps.fetchUsage(deps.tokens.accessToken);
  } catch (err) {
    if (!(err instanceof UsageFetchError) || err.code !== "unauthorized") {
      throw err;
    }
  }

  const result = await deps.refresh(deps.tokens.refreshToken);
  switch (result.kind) {
    case "logout":
    case "policy":
      await deps.clear();
      throw new UsageFetchError("Signed out by Cursor.", "no-token");
    case "transient":
      throw new UsageFetchError("Could not refresh the Cursor session.", "network");
    case "ok": {
      const next: Tokens = {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken ?? deps.tokens.refreshToken,
      };
      await deps.save(next);
      return deps.fetchUsage(next.accessToken);
    }
  }
}

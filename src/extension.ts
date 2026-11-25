import * as vscode from "vscode";
import { AuthSetup, type RefreshResult } from "./authSetup";
import { AuthStore } from "./authStore";
import {
  AuthTokenError,
  DEFAULT_STATE_DB_PATH,
  readAccessToken,
} from "./authToken";
import { UsageStatusBar } from "./statusBar";
import {
  fetchUsageSummary,
  fetchUsageSummaryWithCookie,
  UsageFetchError,
  usageErrorFromCode,
  type UsageSummary,
} from "./usageApi";

let pollTimer: ReturnType<typeof setInterval> | undefined;
let statusBar: UsageStatusBar | undefined;
let authStore: AuthStore | undefined;
let authSetup: AuthSetup | undefined;
/** Refreshes run one after another so a cookie saved mid-poll is still applied. */
let refreshQueue: Promise<unknown> = Promise.resolve();
/** The setup prompt is shown at most once per session; "Not now" keeps the status bar item. */
let setupOfferShown = false;

function getStateDbPath(): string {
  const configured = vscode.workspace
    .getConfiguration("cursorUsage")
    .get<string>("stateDbPath")
    ?.trim();
  return configured || DEFAULT_STATE_DB_PATH;
}

function getPollIntervalMs(): number {
  const minutes = vscode.workspace
    .getConfiguration("cursorUsage")
    .get<number>("pollIntervalMinutes", 5);
  return Math.max(1, minutes) * 60 * 1000;
}

/** A user-facing reason when authorization must be (re)chosen, otherwise undefined. */
function setupReason(err: unknown, mode: string | undefined): string | undefined {
  if (err instanceof AuthTokenError) {
    if (err.code === "consent") {
      return "Cursor's login token is encrypted.";
    }
    if (err.code === "missing") {
      return "No Cursor sign-in or session cookie found.";
    }
  }
  if (err instanceof UsageFetchError && mode === "manual" && err.code === "unauthorized") {
    return "Session expired. Paste a new session cookie.";
  }
  return undefined;
}

function renderError(err: unknown): RefreshResult {
  if (!statusBar) {
    return { ok: false, code: "unknown", message: "Status bar unavailable." };
  }
  if (err instanceof AuthTokenError) {
    statusBar.render({ kind: "error", code: "no-token", message: err.message });
    return { ok: false, code: err.code, message: err.message };
  }
  if (err instanceof UsageFetchError) {
    const message = usageErrorFromCode(err.code);
    statusBar.render({ kind: "error", code: err.code, message });
    return { ok: false, code: err.code, message };
  }
  statusBar.renderFromError(err);
  return {
    ok: false,
    code: "unknown",
    message: err instanceof Error ? err.message : "Failed to load usage.",
  };
}

async function fetchCurrentUsage(mode: string | undefined): Promise<UsageSummary> {
  if (mode === "manual") {
    const cookie = await authStore?.getCookie();
    if (!cookie) {
      throw new AuthTokenError("No session cookie saved.", "missing");
    }
    return fetchUsageSummaryWithCookie(cookie);
  }
  // Without vault consent this throws `consent` for encrypted tokens before any OS prompt.
  const token = await readAccessToken(getStateDbPath(), { allowVault: mode === "vault" });
  return fetchUsageSummary(token);
}

async function refreshOnce(): Promise<RefreshResult> {
  if (!statusBar || !authStore) {
    return { ok: false, code: "unknown", message: "Extension not active." };
  }
  statusBar.render({ kind: "loading" });
  const mode = authStore.getMode();
  try {
    const summary = await fetchCurrentUsage(mode);
    statusBar.render({
      kind: "ok",
      overall: summary.overall,
      updatedAt: new Date(),
      billingCycleStart: summary.billingCycleStart,
      billingCycleEnd: summary.billingCycleEnd,
    });
    return { ok: true };
  } catch (err) {
    const reason = setupReason(err, mode);
    if (reason) {
      statusBar.render({ kind: "setup", message: reason });
      if (!setupOfferShown && authSetup) {
        setupOfferShown = true;
        void authSetup.offerChoice(reason);
      }
      return {
        ok: false,
        code: err instanceof AuthTokenError ? err.code : "unauthorized",
        message: reason,
      };
    }
    return renderError(err);
  }
}

function refreshUsage(): Promise<RefreshResult> {
  const run = refreshQueue.then(refreshOnce);
  refreshQueue = run.catch(() => undefined);
  return run;
}

function startPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
  }
  pollTimer = setInterval(() => {
    void refreshUsage();
  }, getPollIntervalMs());
}

export function activate(context: vscode.ExtensionContext): void {
  statusBar = new UsageStatusBar(100);
  statusBar.show();

  authStore = new AuthStore(context.globalState, context.secrets);
  authSetup = new AuthSetup({ store: authStore, refresh: refreshUsage });
  const setup = authSetup;

  const refreshCmd = vscode.commands.registerCommand("cursorUsage.refresh", () => {
    void refreshUsage();
  });
  const setupCmd = vscode.commands.registerCommand("cursorUsage.setupAuth", () => {
    void setup.chooseMethod();
  });
  const cookieCmd = vscode.commands.registerCommand("cursorUsage.useManualCookie", () => {
    void setup.useManualCookie();
  });
  const vaultCmd = vscode.commands.registerCommand("cursorUsage.allowVaultAccess", () => {
    void setup.allowVaultAccess();
  });
  const clearCmd = vscode.commands.registerCommand("cursorUsage.clearAuth", () => {
    void setup.clearAuth();
  });

  const onConfigChange = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("cursorUsage.pollIntervalMinutes")) {
      startPolling();
    }
    if (
      e.affectsConfiguration("cursorUsage.stateDbPath") ||
      e.affectsConfiguration("cursorUsage.pollIntervalMinutes")
    ) {
      void refreshUsage();
    }
  });

  context.subscriptions.push(
    refreshCmd,
    setupCmd,
    cookieCmd,
    vaultCmd,
    clearCmd,
    onConfigChange,
    {
      dispose: () => {
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = undefined;
        }
        statusBar?.dispose();
        statusBar = undefined;
        authSetup = undefined;
        authStore = undefined;
      },
    },
  );

  startPolling();
  void refreshUsage();
}

export function deactivate(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = undefined;
  }
  statusBar?.dispose();
  statusBar = undefined;
}

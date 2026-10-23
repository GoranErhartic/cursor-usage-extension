import * as vscode from "vscode";
import {
  AuthTokenError,
  DEFAULT_STATE_DB_PATH,
  readAccessToken,
} from "./authToken";
import { UsageStatusBar } from "./statusBar";
import { fetchUsageSummary, UsageFetchError, usageErrorFromCode } from "./usageApi";

let pollTimer: ReturnType<typeof setInterval> | undefined;
let statusBar: UsageStatusBar | undefined;
let refreshInFlight = false;

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

async function refreshUsage(): Promise<void> {
  if (!statusBar || refreshInFlight) {
    return;
  }
  refreshInFlight = true;
  statusBar.render({ kind: "loading" });
  try {
    const token = await readAccessToken(getStateDbPath());
    const summary = await fetchUsageSummary(token);
    statusBar.render({
      kind: "ok",
      overall: summary.overall,
      updatedAt: new Date(),
      billingCycleStart: summary.billingCycleStart,
      billingCycleEnd: summary.billingCycleEnd,
    });
  } catch (err) {
    if (err instanceof AuthTokenError) {
      statusBar.render({
        kind: "error",
        code: "no-token",
        message: err.message,
      });
    } else if (err instanceof UsageFetchError) {
      statusBar.render({
        kind: "error",
        code: err.code,
        message: usageErrorFromCode(err.code),
      });
    } else {
      statusBar.renderFromError(err);
    }
  } finally {
    refreshInFlight = false;
  }
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

  const refreshCmd = vscode.commands.registerCommand("cursorUsage.refresh", () => {
    void refreshUsage();
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

  context.subscriptions.push(refreshCmd, onConfigChange, {
    dispose: () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = undefined;
      }
      statusBar?.dispose();
      statusBar = undefined;
    },
  });

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

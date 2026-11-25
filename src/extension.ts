import * as vscode from "vscode";
import { AuthStore } from "./authStore";
import {
  buildLoginUrl,
  createLoginHandshake,
  LoginError,
  pollForLoginTokens,
  refreshSession,
} from "./browserLogin";
import { UsageStatusBar } from "./statusBar";
import { fetchUsageSummary, UsageFetchError, usageErrorFromCode } from "./usageApi";
import { fetchUsageWithRefresh } from "./usageWithRefresh";

let pollTimer: ReturnType<typeof setInterval> | undefined;
let statusBar: UsageStatusBar | undefined;
let authStore: AuthStore | undefined;
/** Refreshes run one after another so two polls never refresh the session at once. */
let refreshQueue: Promise<unknown> = Promise.resolve();
/** The sign-in prompt is shown at most once per session. */
let signInOfferShown = false;
let signInInProgress = false;

function getPollIntervalMs(): number {
  const minutes = vscode.workspace
    .getConfiguration("cursorUsage")
    .get<number>("pollIntervalMinutes", 5);
  return Math.max(1, minutes) * 60 * 1000;
}

function showSignIn(message: string, offer: boolean): void {
  statusBar?.render({ kind: "signin", message });
  if (offer && !signInOfferShown) {
    signInOfferShown = true;
    void vscode.window
      .showInformationMessage(`Cursor Usage: ${message}`, "Sign in")
      .then((choice) => {
        if (choice === "Sign in") {
          void vscode.commands.executeCommand("cursorUsage.signIn");
        }
      });
  }
}

async function refreshOnce(): Promise<void> {
  const store = authStore;
  if (!statusBar || !store) {
    return;
  }
  const tokens = await store.getTokens();
  if (!tokens) {
    showSignIn("Sign in to Cursor in your browser to see usage.", true);
    return;
  }
  statusBar.render({ kind: "loading" });
  try {
    const summary = await fetchUsageWithRefresh({
      tokens,
      fetchUsage: fetchUsageSummary,
      refresh: (refreshToken) => refreshSession(refreshToken),
      save: (next) => store.setTokens(next),
      clear: () => store.clear(),
    });
    statusBar.render({
      kind: "ok",
      overall: summary.overall,
      updatedAt: new Date(),
      billingCycleStart: summary.billingCycleStart,
      billingCycleEnd: summary.billingCycleEnd,
    });
  } catch (err) {
    if (err instanceof UsageFetchError && err.code === "no-token") {
      showSignIn("Session ended. Sign in to Cursor again.", true);
      return;
    }
    if (err instanceof UsageFetchError) {
      statusBar.render({ kind: "error", code: err.code, message: usageErrorFromCode(err.code) });
      return;
    }
    statusBar.renderFromError(err);
  }
}

function refreshUsage(): Promise<void> {
  const run = refreshQueue.then(refreshOnce);
  refreshQueue = run.catch(() => undefined);
  return run;
}

async function signIn(): Promise<void> {
  const store = authStore;
  if (!store || signInInProgress) {
    return;
  }
  signInInProgress = true;
  try {
    const handshake = createLoginHandshake();
    const opened = await vscode.env.openExternal(vscode.Uri.parse(buildLoginUrl(handshake)));
    if (!opened) {
      void vscode.window.showErrorMessage("Cursor Usage: could not open the browser.");
      return;
    }
    const tokens = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Cursor Usage: waiting for you to sign in in the browser…",
        cancellable: true,
      },
      (_progress, cancel) => {
        const controller = new AbortController();
        cancel.onCancellationRequested(() => controller.abort());
        return pollForLoginTokens(handshake, { signal: controller.signal });
      },
    );
    // Verify the session works before saving it.
    await fetchUsageSummary(tokens.accessToken);
    await store.setTokens(tokens);
    await store.clearLegacy();
    void vscode.window.showInformationMessage("Cursor Usage: signed in.");
    await refreshUsage();
  } catch (err) {
    if (err instanceof LoginError && err.code === "cancelled") {
      return;
    }
    const message =
      err instanceof LoginError
        ? err.message
        : err instanceof UsageFetchError
          ? usageErrorFromCode(err.code)
          : "Sign-in failed.";
    void vscode.window.showErrorMessage(`Cursor Usage: ${message}`);
  } finally {
    signInInProgress = false;
  }
}

async function signOut(): Promise<void> {
  await authStore?.clear();
  signInOfferShown = true;
  showSignIn("Signed out.", false);
}

export function activate(context: vscode.ExtensionContext): void {
  statusBar = new UsageStatusBar(100);
  statusBar.show();

  authStore = new AuthStore(context.globalState, context.secrets);
  void authStore.clearLegacy();

  const refreshCmd = vscode.commands.registerCommand("cursorUsage.refresh", () => {
    void refreshUsage();
  });
  const signInCmd = vscode.commands.registerCommand("cursorUsage.signIn", () => {
    void signIn();
  });
  const signOutCmd = vscode.commands.registerCommand("cursorUsage.signOut", () => {
    void signOut();
  });

  const onConfigChange = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("cursorUsage.pollIntervalMinutes")) {
      startPolling();
      void refreshUsage();
    }
  });

  context.subscriptions.push(refreshCmd, signInCmd, signOutCmd, onConfigChange, {
    dispose: () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = undefined;
      }
      statusBar?.dispose();
      statusBar = undefined;
      authStore = undefined;
    },
  });

  startPolling();
  void refreshUsage();
}

function startPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
  }
  pollTimer = setInterval(() => {
    void refreshUsage();
  }, getPollIntervalMs());
}

export function deactivate(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = undefined;
  }
  statusBar?.dispose();
  statusBar = undefined;
}

import * as vscode from "vscode";
import type { AuthStore } from "./authStore";
import { normalizeSessionCookie } from "./jwt";
import { fetchUsageSummaryWithCookie, UsageFetchError, usageErrorFromCode } from "./usageApi";

export type RefreshResult =
  | { ok: true }
  | { ok: false; code: string; message: string };

const CURSOR_DASHBOARD_URL = "https://cursor.com/dashboard";
const COOKIE_NAME = "WorkosCursorSessionToken";

export const MANUAL_STEPS_MARKDOWN = `# Get your Cursor session cookie

1. Open https://cursor.com/dashboard in your browser and sign in.
2. Open developer tools: F12, or Cmd+Option+I on macOS, Ctrl+Shift+I on Windows and Linux.
3. Go to the cookie storage:
   - Chrome or Edge: **Application** tab, then **Cookies**, then \`https://cursor.com\`.
   - Firefox: **Storage** tab, then **Cookies**, then \`https://cursor.com\`.
   - Safari: enable the Develop menu first (Settings, Advanced), then the **Storage** tab, then **Cookies**.
4. Find \`${COOKIE_NAME}\` and copy its **Value** (double-click the value cell, then copy).
5. Paste it into the input box in VS Code.

## Notes

- The value is stored in VS Code's SecretStorage, not in settings or logs.
- Remove it at any time with **Cursor Usage: Clear Saved Authorization**.
- When your browser session expires, the status bar asks you to paste a new value.
`;

/** OS-specific description of what the vault option will do. */
export function vaultExplanation(platform: NodeJS.Platform): string {
  switch (platform) {
    case "darwin":
      return 'macOS will ask to allow access to the "Cursor Safe Storage" item in your login Keychain. Choose "Always Allow" to avoid repeated prompts.';
    case "win32":
      return "Windows unprotects Cursor's encryption key with DPAPI for your user account (via PowerShell). No password prompt is normally shown.";
    default:
      return "Linux reads Cursor's key from the Secret Service keyring (GNOME Keyring or KWallet) with secret-tool. The keyring may ask you to unlock it.";
  }
}

export interface AuthSetupDeps {
  store: AuthStore;
  /** Re-reads usage with the current authorization. */
  refresh: () => Promise<RefreshResult>;
  platform?: NodeJS.Platform;
}

async function showSteps(): Promise<void> {
  const doc = await vscode.workspace.openTextDocument({
    language: "markdown",
    content: MANUAL_STEPS_MARKDOWN,
  });
  await vscode.window.showTextDocument(doc, { preview: true });
}

export class AuthSetup {
  constructor(private readonly deps: AuthSetupDeps) {}

  private get platform(): NodeJS.Platform {
    return this.deps.platform ?? process.platform;
  }

  /** The one-time, non-modal prompt shown when authorization is first needed. */
  async offerChoice(reason: string): Promise<void> {
    const pick = await vscode.window.showInformationMessage(
      `Cursor Usage: ${reason} Choose how it should get your usage.`,
      "Paste session cookie",
      "Allow vault access",
      "Not now",
    );
    if (pick === "Paste session cookie") {
      await this.useManualCookie();
    } else if (pick === "Allow vault access") {
      await this.allowVaultAccess();
    }
  }

  /** Command: explains both options and runs the one the user picks. */
  async chooseMethod(): Promise<void> {
    type Option = vscode.QuickPickItem & { action: "manual" | "vault" };
    const options: Option[] = [
      {
        label: "$(key) Paste session cookie",
        description: "No system prompts",
        detail:
          "Copy the WorkosCursorSessionToken cookie from cursor.com in your browser's developer tools. It is stored in VS Code's SecretStorage and must be pasted again when the session expires.",
        action: "manual",
      },
      {
        label: "$(lock) Allow vault access",
        description: "Automatic, uses Cursor's own login",
        detail: vaultExplanation(this.platform),
        action: "vault",
      },
    ];
    const pick = await vscode.window.showQuickPick(options, {
      title: "Cursor Usage: how should it get your usage?",
      placeHolder: "Pick one. You can change this later.",
      ignoreFocusOut: true,
    });
    if (!pick) {
      return;
    }
    if (pick.action === "manual") {
      await this.useManualCookie();
    } else {
      await this.allowVaultAccess();
    }
  }

  /** Guides the user to copy the cookie, validates it, verifies it, then stores it. */
  async useManualCookie(): Promise<void> {
    const start = await vscode.window.showInformationMessage(
      "Paste your cursor.com session cookie. The steps take about a minute.",
      "Show steps",
      "Open cursor.com",
      "I have the value",
    );
    if (!start) {
      return;
    }
    if (start === "Show steps") {
      await showSteps();
    } else if (start === "Open cursor.com") {
      await vscode.env.openExternal(vscode.Uri.parse(CURSOR_DASHBOARD_URL));
    }

    const input = await vscode.window.showInputBox({
      title: "Cursor Usage: session cookie",
      prompt: `Paste the value of ${COOKIE_NAME}`,
      password: true,
      ignoreFocusOut: true,
      validateInput: (value) =>
        normalizeSessionCookie(value)
          ? undefined
          : "This does not look like a session cookie. Copy the Value of the cookie from the steps.",
    });
    if (input === undefined) {
      return;
    }
    const cookie = normalizeSessionCookie(input);
    if (!cookie) {
      void vscode.window.showErrorMessage(
        "Cursor Usage: that does not look like a session cookie. Nothing was saved.",
      );
      return;
    }

    const failure = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Cursor Usage: verifying session cookie",
      },
      async (): Promise<string | undefined> => {
        try {
          await fetchUsageSummaryWithCookie(cookie);
          return undefined;
        } catch (err) {
          if (err instanceof UsageFetchError && err.code === "unauthorized") {
            return "cursor.com rejected that value. Copy it again from the steps.";
          }
          if (err instanceof UsageFetchError) {
            return usageErrorFromCode(err.code);
          }
          return "Could not verify the cookie.";
        }
      },
    );
    if (failure) {
      void vscode.window.showErrorMessage(`Cursor Usage: ${failure} Nothing was saved.`);
      return;
    }

    await this.deps.store.setCookie(cookie);
    await this.deps.store.setMode("manual");
    const result = await this.deps.refresh();
    if (result.ok) {
      void vscode.window.showInformationMessage(
        "Cursor Usage: session cookie saved. Usage will refresh automatically.",
      );
    } else {
      void vscode.window.showWarningMessage(
        `Cursor Usage: cookie saved, but ${result.message}`,
      );
    }
  }

  /** Lets the extension read Cursor's encrypted token. The OS may prompt for access. */
  async allowVaultAccess(): Promise<void> {
    const consent = await vscode.window.showInformationMessage(
      `Cursor Usage will read Cursor's encrypted login token. ${vaultExplanation(this.platform)}`,
      { modal: true },
      "Allow vault access",
    );
    if (consent !== "Allow vault access") {
      return;
    }

    await this.deps.store.setMode("vault");
    const result = await this.deps.refresh();
    if (!result.ok) {
      const next = await vscode.window.showWarningMessage(
        `Cursor Usage: ${result.message}`,
        "Paste session cookie instead",
      );
      if (next) {
        await this.useManualCookie();
      }
    }
  }

  /** Command: forgets the saved cookie and mode, then shows the setup state again. */
  async clearAuth(): Promise<void> {
    await this.deps.store.clear();
    await this.deps.refresh();
    void vscode.window.showInformationMessage("Cursor Usage: saved authorization removed.");
  }
}

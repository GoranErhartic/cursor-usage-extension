# Cursor Usage

[![Ko-fi](https://img.shields.io/badge/Ko--fi-Support%20Me-F16061?logo=ko-fi&logoColor=white)](https://ko-fi.com/goranlegenda)

Shows your Cursor plan usage in the status bar (for example `$105.55/$200`). Refreshes every 5 minutes and when you click the item.

## Requirements

- macOS, Windows or Linux
- Either a signed-in Cursor on the same user account (vault access), or a session cookie copied from cursor.com

### Authorization

Recent Cursor versions store the session token encrypted. The extension never opens the OS secure store on its own. The first time it needs authorization, the status bar shows `$(key) Usage: set up` and a one-time prompt offers two options:

1. **Paste session cookie (no system prompts).** Copy one value from your browser and paste it into VS Code. The value is stored in VS Code's SecretStorage and checked against cursor.com before it is saved. It must be pasted again when your browser session expires.
2. **Allow vault access (automatic).** The extension reads Cursor's own login token from the OS secure store:
   - macOS: the **Cursor Safe Storage** item in your login Keychain. macOS asks for access; choose **Always Allow** to avoid repeated prompts.
   - Windows: Cursor's `Local State` key, unprotected with DPAPI for your user (via PowerShell).
   - Linux: the Secret Service keyring (GNOME Keyring or KWallet, via `secret-tool`). Chromium's built-in fallback is used without any keyring access.

Plain (unencrypted) tokens are used without any prompt. Click the status bar item or run **Cursor Usage: Set Up Authorization** to change your choice at any time.

#### Get your session cookie (step by step)

1. Open [cursor.com/dashboard](https://cursor.com/dashboard) and sign in.
2. Open developer tools: `F12`, or `Cmd+Option+I` on macOS, `Ctrl+Shift+I` on Windows and Linux.
3. Go to the cookie storage:
   - Chrome or Edge: **Application** tab, then **Cookies**, then `https://cursor.com`.
   - Firefox: **Storage** tab, then **Cookies**, then `https://cursor.com`.
   - Safari: enable the Develop menu first (Settings, Advanced), then the **Storage** tab, then **Cookies**.
4. Find `WorkosCursorSessionToken` and copy its **Value**.
5. Run **Cursor Usage: Paste Session Cookie** and paste the value.

The extension also accepts the full `WorkosCursorSessionToken=...` pair or a bare session JWT.

On Windows and Linux the vault path is not manually tested: if you see "Failed to obtain the decoded JWT session token", choose the session cookie option, or [report it](https://github.com/GoranErhartic/cursor-usage-extension/issues) with your OS and Cursor version. The vault path relies on an undocumented Cursor storage format and may change in future Cursor versions.

### Commands

| Command | What it does |
|--------|--------------|
| **Cursor Usage: Refresh** | Refreshes usage now |
| **Cursor Usage: Set Up Authorization** | Explains both options and runs the one you pick |
| **Cursor Usage: Paste Session Cookie** | Guided cookie setup |
| **Cursor Usage: Allow Vault Access** | Reads Cursor's encrypted token from the OS secure store |
| **Cursor Usage: Clear Saved Authorization** | Deletes the saved cookie and forgets the chosen option |

## Usage

1. Run **Extensions: Install from VSIX** or press **F5** in this repo to launch an Extension Development Host.
2. The status bar shows `$(graph) $used/$limit`. Click it or run **Cursor Usage: Refresh** to update immediately.

## Settings

| Setting | Default | Description |
|--------|---------|-------------|
| `cursorUsage.pollIntervalMinutes` | `5` | Poll interval in minutes |
| `cursorUsage.stateDbPath` | *(empty)* | Override path to `state.vscdb` |

Default database paths:

- macOS: `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb`
- Windows: `%APPDATA%\Cursor\User\globalStorage\state.vscdb`
- Linux: `~/.config/Cursor/User/globalStorage/state.vscdb`

## Development

```bash
pnpm install
pnpm run compile
pnpm test
```

## Publishing (Open VSX)

The extension ID is `goranerhartic.cursor-usage` (publisher `goranerhartic`).

1. Sign in at [open-vsx.org](https://open-vsx.org) with GitHub, sign the Publisher Agreement and create an access token.
2. Create the namespace (once): `npx ovsx create-namespace goranerhartic -p <token>`
3. Claim ownership of the namespace via the Open VSX namespace-claim issue (otherwise it shows as unverified).
4. Build and publish: `pnpm run package && pnpm dlx ovsx publish cursor-usage-<version>.vsix -p <token>`

## Privacy

The extension sends your session to `https://cursor.com/api/usage-summary` only. With vault access, it reads Cursor's token from your local database and decrypts it in memory. With a pasted cookie, the value is kept in VS Code's SecretStorage. Neither is written to settings or logs.

## Support

If you find this project useful, consider supporting its development:

Buy me a coffee at [ko-fi.com/goranlegenda](https://ko-fi.com/goranlegenda).

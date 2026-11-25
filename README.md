# Cursor Usage

[![Ko-fi](https://img.shields.io/badge/Ko--fi-Support%20Me-F16061?logo=ko-fi&logoColor=white)](https://ko-fi.com/goranlegenda)

Shows your Cursor plan usage in the status bar (for example `$105.55/$200`). Refreshes every 5 minutes and when you click the item.

## Requirements

- macOS, Windows or Linux
- A Cursor account. Sign-in happens in your browser, so SSO (your company identity provider) works.

### Sign in

The status bar shows `$(key) Usage: sign in` until you sign in. Click it or run **Cursor Usage: Sign In**. Your browser opens cursor.com, you sign in (through SSO if your organization uses it), and the extension picks up the session. Tokens are stored in VS Code's SecretStorage only. When the access token expires, the extension refreshes it automatically. If Cursor ends the session, the status bar asks you to sign in again.

The extension no longer reads Cursor's local login, the OS keychain or a pasted cookie. If you used an earlier version, sign in once after upgrading.

### Commands

| Command | What it does |
|--------|--------------|
| **Cursor Usage: Refresh** | Refreshes usage now |
| **Cursor Usage: Sign In** | Browser sign-in (SSO supported) |
| **Cursor Usage: Sign Out** | Deletes the saved tokens |

### Risks

- The login and refresh endpoints are undocumented and may change without notice. The refresh request format comes from third-party clients.
- Enterprise sign-in policies can block the flow. There is no fallback method.
- Each sign-in appears as a new session on your Cursor account.

## Usage

1. Run **Extensions: Install from VSIX** or press **F5** in this repo to launch an Extension Development Host.
2. The status bar shows `$(graph) $used/$limit`. Click it or run **Cursor Usage: Refresh** to update immediately.

## Settings

| Setting | Default | Description |
|--------|---------|-------------|
| `cursorUsage.pollIntervalMinutes` | `5` | Poll interval in minutes |

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

The extension contacts only Cursor: `https://cursor.com/loginDeepControl` (opened in your browser), `https://api2.cursor.sh/auth/poll` (to receive the tokens after sign-in), `https://api2.cursor.sh/oauth/token` (to refresh the session) and `https://cursor.com/api/usage-summary` (usage). Tokens are kept in VS Code's SecretStorage and are never written to settings or logs.

## Support

If you find this project useful, consider supporting its development:

Buy me a coffee at [ko-fi.com/goranlegenda](https://ko-fi.com/goranlegenda).

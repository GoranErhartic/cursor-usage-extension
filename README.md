# Cursor Usage

[![Ko-fi](https://img.shields.io/badge/Ko--fi-Support%20Me-F16061?logo=ko-fi&logoColor=white)](https://ko-fi.com/goranlegenda)

Shows your Cursor plan usage in the status bar (for example `$105.55/$200`). Refreshes every 5 minutes and when you click the item.

## Requirements

- macOS, Windows or Linux (reads the signed-in session from Cursor’s local state database with a built-in, dependency-free SQLite reader)
- You must be signed in to Cursor in the same user account

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
npm install
npm run compile
npm test
```

## Publishing (Open VSX)

The extension ID is `goranerhartic.cursor-usage` (publisher `goranerhartic`).

1. Sign in at [open-vsx.org](https://open-vsx.org) with GitHub, sign the Publisher Agreement and create an access token.
2. Create the namespace (once): `npx ovsx create-namespace goranerhartic -p <token>`
3. Claim ownership of the namespace via the Open VSX namespace-claim issue (otherwise it shows as unverified).
4. Build and publish: `npm run package && npx ovsx publish cursor-usage-<version>.vsix -p <token>`

## Privacy

The access token is read from your local Cursor database only to call `https://cursor.com/api/usage-summary`. It is not logged or stored by the extension.

## Support

If you find this project useful, consider supporting its development:

[![Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/goranlegenda)

Or buy me a coffee at [ko-fi.com/goranlegenda](https://ko-fi.com/goranlegenda).

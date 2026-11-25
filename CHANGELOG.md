# Changelog

## 1.0.0

- **Breaking:** the only authorization method is now browser sign-in, which supports SSO. Sign in once after upgrading; the status bar shows `Usage: sign in` until you do.
- The access token is refreshed automatically when it expires.
- Removed: reading Cursor's local login (`state.vscdb`), Keychain/DPAPI/keyring decryption, pasted session cookies, vault access and the `cursorUsage.stateDbPath` setting.
- Commands: `Sign In` and `Sign Out` replace Set Up Authorization, Paste Session Cookie, Allow Vault Access and Clear Saved Authorization.
- Data saved by 0.7.0 is deleted.

## 0.7.0

- No more unprompted OS secure-store access. When authorization is needed, the status bar shows `Usage: set up` and a one-time prompt lets you choose:
  - **Paste session cookie**: a guided, step-by-step setup for copying `WorkosCursorSessionToken` from cursor.com. The value is verified and stored in SecretStorage.
  - **Allow vault access**: reads Cursor's encrypted token from the macOS Keychain, Windows DPAPI or the Linux keyring after you confirm.
- New commands: Set Up Authorization, Paste Session Cookie, Allow Vault Access, Clear Saved Authorization.
- Expired cookies are reported as "Session expired. Paste a new session cookie."

## 0.6.0

- Fixed the "Sign in to Cursor to see usage" error on recent Cursor versions, which store the access token encrypted (`cursor-safe-storage:v1:`). On macOS the extension now decrypts it using the "Cursor Safe Storage" Keychain item; macOS will ask you to allow Keychain access.
- Added token decryption on Windows (DPAPI + AES-256-GCM) and Linux (libsecret keyring / Chromium fallback password).
- If decryption fails, the error now says the decoded JWT session token could not be obtained and asks you to report it.
- Clearer error messages when the token can't be decrypted (Keychain access denied, or unsupported platform) instead of a misleading "Sign in" message.

## 0.5.0

- Migrated the project tooling from npm to pnpm.

## 0.4.1

- Set extension homepage to [LazyDev](https://lazydev.ai/#cursor-usage).

## 0.4.0

- Added an extension icon.

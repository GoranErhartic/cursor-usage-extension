# Changelog

## 0.6.0

- Fixed the "Sign in to Cursor to see usage" error on recent Cursor versions, which store the access token encrypted (`cursor-safe-storage:v1:`). On macOS the extension now decrypts it using the "Cursor Safe Storage" Keychain item; macOS will ask you to allow Keychain access.
- Clearer error messages when the token can't be decrypted (Keychain access denied, or unsupported platform) instead of a misleading "Sign in" message.

## 0.5.0

- Migrated the project tooling from npm to pnpm.

## 0.4.1

- Set extension homepage to [LazyDev](https://lazydev.ai/#cursor-usage).

## 0.4.0

- Added an extension icon.

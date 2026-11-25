/**
 * How the extension authorizes usage requests.
 * - `manual`: a `WorkosCursorSessionToken` cookie the user pasted from cursor.com.
 * - `vault`: the user allowed reading Cursor's encrypted token via the OS secure store.
 * - unset: only plain (unencrypted) tokens are used; nothing touches the OS store.
 */
export type AuthMode = "manual" | "vault";

/** Subset of `vscode.Memento` used here (kept structural so tests need no vscode). */
export interface KeyValueStore {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}

/** Subset of `vscode.SecretStorage` used here. */
export interface SecretStoreLike {
  get(key: string): PromiseLike<string | undefined>;
  store(key: string, value: string): PromiseLike<void>;
  delete(key: string): PromiseLike<void>;
}

export const AUTH_MODE_KEY = "cursorUsage.authMode";
export const SESSION_COOKIE_KEY = "cursorUsage.sessionCookie";

export class AuthStore {
  constructor(
    private readonly state: KeyValueStore,
    private readonly secrets: SecretStoreLike,
  ) {}

  getMode(): AuthMode | undefined {
    const value = this.state.get<string>(AUTH_MODE_KEY);
    return value === "manual" || value === "vault" ? value : undefined;
  }

  async setMode(mode: AuthMode | undefined): Promise<void> {
    await this.state.update(AUTH_MODE_KEY, mode);
  }

  /** Returns the stored cookie value. Never log the result. */
  getCookie(): PromiseLike<string | undefined> {
    return this.secrets.get(SESSION_COOKIE_KEY);
  }

  async setCookie(cookieValue: string): Promise<void> {
    await this.secrets.store(SESSION_COOKIE_KEY, cookieValue);
  }

  /** Forgets the pasted cookie and the chosen mode. */
  async clear(): Promise<void> {
    await this.setMode(undefined);
    await this.secrets.delete(SESSION_COOKIE_KEY);
  }
}

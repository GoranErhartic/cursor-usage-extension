import type { Tokens } from "./browserLogin";

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

export const ACCESS_TOKEN_KEY = "cursorUsage.accessToken";
export const REFRESH_TOKEN_KEY = "cursorUsage.refreshToken";
/** Left behind by 0.7.0. */
export const LEGACY_SESSION_COOKIE_KEY = "cursorUsage.sessionCookie";
export const LEGACY_AUTH_MODE_KEY = "cursorUsage.authMode";

/** Tokens live in SecretStorage only. Never log them. */
export class AuthStore {
  constructor(
    private readonly state: KeyValueStore,
    private readonly secrets: SecretStoreLike,
  ) {}

  async getTokens(): Promise<Tokens | undefined> {
    const accessToken = await this.secrets.get(ACCESS_TOKEN_KEY);
    const refreshToken = await this.secrets.get(REFRESH_TOKEN_KEY);
    return accessToken && refreshToken ? { accessToken, refreshToken } : undefined;
  }

  async setTokens(tokens: Tokens): Promise<void> {
    await this.secrets.store(ACCESS_TOKEN_KEY, tokens.accessToken);
    await this.secrets.store(REFRESH_TOKEN_KEY, tokens.refreshToken);
  }

  /** Removes the tokens and anything stored by 0.7.0. */
  async clear(): Promise<void> {
    await this.secrets.delete(ACCESS_TOKEN_KEY);
    await this.secrets.delete(REFRESH_TOKEN_KEY);
    await this.secrets.delete(LEGACY_SESSION_COOKIE_KEY);
    await this.state.update(LEGACY_AUTH_MODE_KEY, undefined);
  }

  /** Drops 0.7.0 leftovers without touching current tokens. */
  async clearLegacy(): Promise<void> {
    await this.secrets.delete(LEGACY_SESSION_COOKIE_KEY);
    await this.state.update(LEGACY_AUTH_MODE_KEY, undefined);
  }
}

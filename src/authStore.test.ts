import { describe, expect, it } from "vitest";
import {
  ACCESS_TOKEN_KEY,
  AuthStore,
  LEGACY_AUTH_MODE_KEY,
  LEGACY_SESSION_COOKIE_KEY,
  REFRESH_TOKEN_KEY,
} from "./authStore";

class FakeState {
  readonly values = new Map<string, unknown>();
  get<T>(key: string): T | undefined {
    return this.values.get(key) as T | undefined;
  }
  async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) {
      this.values.delete(key);
    } else {
      this.values.set(key, value);
    }
  }
}

class FakeSecrets {
  readonly values = new Map<string, string>();
  async get(key: string): Promise<string | undefined> {
    return this.values.get(key);
  }
  async store(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }
}

describe("AuthStore", () => {
  it("keeps tokens in SecretStorage only", async () => {
    const state = new FakeState();
    const secrets = new FakeSecrets();
    const store = new AuthStore(state, secrets);
    await store.setTokens({ accessToken: "a", refreshToken: "r" });
    expect(secrets.values.get(ACCESS_TOKEN_KEY)).toBe("a");
    expect(secrets.values.get(REFRESH_TOKEN_KEY)).toBe("r");
    expect(state.values.size).toBe(0);
    expect(await store.getTokens()).toEqual({ accessToken: "a", refreshToken: "r" });
  });

  it("returns undefined when a token is missing", async () => {
    const secrets = new FakeSecrets();
    secrets.values.set(ACCESS_TOKEN_KEY, "a");
    expect(await new AuthStore(new FakeState(), secrets).getTokens()).toBeUndefined();
  });

  it("clear removes tokens and legacy 0.7.0 data", async () => {
    const state = new FakeState();
    const secrets = new FakeSecrets();
    const store = new AuthStore(state, secrets);
    await store.setTokens({ accessToken: "a", refreshToken: "r" });
    secrets.values.set(LEGACY_SESSION_COOKIE_KEY, "c");
    state.values.set(LEGACY_AUTH_MODE_KEY, "manual");
    await store.clear();
    expect(secrets.values.size).toBe(0);
    expect(state.values.size).toBe(0);
  });

  it("clearLegacy keeps current tokens", async () => {
    const state = new FakeState();
    const secrets = new FakeSecrets();
    const store = new AuthStore(state, secrets);
    await store.setTokens({ accessToken: "a", refreshToken: "r" });
    secrets.values.set(LEGACY_SESSION_COOKIE_KEY, "c");
    state.values.set(LEGACY_AUTH_MODE_KEY, "vault");
    await store.clearLegacy();
    expect(secrets.values.has(LEGACY_SESSION_COOKIE_KEY)).toBe(false);
    expect(state.values.size).toBe(0);
    expect(await store.getTokens()).toBeDefined();
  });
});

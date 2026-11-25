import { describe, expect, it } from "vitest";
import { AUTH_MODE_KEY, AuthStore, SESSION_COOKIE_KEY } from "./authStore";

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
  it("has no mode until one is chosen", () => {
    const store = new AuthStore(new FakeState(), new FakeSecrets());
    expect(store.getMode()).toBeUndefined();
  });

  it("persists mode in the state store and ignores unknown values", async () => {
    const state = new FakeState();
    const store = new AuthStore(state, new FakeSecrets());
    await store.setMode("vault");
    expect(store.getMode()).toBe("vault");
    state.values.set(AUTH_MODE_KEY, "bogus");
    expect(store.getMode()).toBeUndefined();
  });

  it("keeps the cookie in SecretStorage, never in the state store", async () => {
    const state = new FakeState();
    const secrets = new FakeSecrets();
    const store = new AuthStore(state, secrets);
    await store.setCookie("uid%3A%3Ajwt.a.b");
    expect(await store.getCookie()).toBe("uid%3A%3Ajwt.a.b");
    expect(secrets.values.get(SESSION_COOKIE_KEY)).toBe("uid%3A%3Ajwt.a.b");
    expect([...state.values.values()]).not.toContain("uid%3A%3Ajwt.a.b");
  });

  it("clear removes both the mode and the cookie", async () => {
    const state = new FakeState();
    const secrets = new FakeSecrets();
    const store = new AuthStore(state, secrets);
    await store.setMode("manual");
    await store.setCookie("x");
    await store.clear();
    expect(store.getMode()).toBeUndefined();
    expect(await store.getCookie()).toBeUndefined();
  });
});

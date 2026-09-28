import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ default: vi.fn(() => vi.fn()) }));
vi.mock("utils/logger", () => ({ default: () => ({ warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }));

describe("local multi-user credentials adapter", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("HOMEPAGE_AUTH_ENABLED", "true");
    vi.stubEnv("HOMEPAGE_AUTH_SECRET", "test-secret-at-least-thirty-two-characters");
    vi.stubEnv("HOMEPAGE_EXTERNAL_URL", "https://homepage.example");
    vi.stubEnv("HOMEPAGE_CREDENTIALS_URL", "http://accounts:8080/internal/verify");
    vi.stubEnv("HOMEPAGE_CREDENTIALS_SECRET", "internal-test-key");
    vi.stubEnv("NEXTAUTH_URL", "");
    vi.stubEnv("NEXTAUTH_SECRET", "");
    vi.stubEnv("HOMEPAGE_AUTH_PASSWORD", "");
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  const options = async () => (await import("pages/api/auth/[...nextauth]")).authOptions;
  const identity = { id: "kele", name: "kele", credentialVersion: "version-from-account-store" };

  it("checks existing credentials server-side and returns a native identity", async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => identity });
    const auth = await options();
    await expect(auth.providers[0].options.authorize({ username: " kele ", password: "private-password" })).resolves.toEqual(identity);
    expect(fetch).toHaveBeenCalledWith("http://accounts:8080/internal/verify", expect.objectContaining({
      method: "POST", redirect: "error",
      headers: { "Content-Type": "application/json", Authorization: "Bearer internal-test-key" },
      body: JSON.stringify({ username: "kele", password: "private-password" }),
    }));
  });

  it.each([{}, { username: 5, password: "valid" }, { username: "../kele", password: "valid" }, { username: "kele", password: 5 }])(
    "rejects malformed credentials before contacting the verifier: %j", async (credentials) => {
      const auth = await options();
      await expect(auth.providers[0].options.authorize(credentials)).resolves.toBeNull();
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("fails closed on a wrong password, verifier failure or mismatched identity", async () => {
    const auth = await options();
    const authorize = auth.providers[0].options.authorize;
    fetch.mockResolvedValueOnce({ ok: false });
    await expect(authorize({ username: "kele", password: "wrong" })).resolves.toBeNull();
    fetch.mockRejectedValueOnce(new Error("unavailable"));
    await expect(authorize({ username: "kele", password: "valid" })).resolves.toBeNull();
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ...identity, name: "wzj" }) });
    await expect(authorize({ username: "kele", password: "valid" })).resolves.toBeNull();
  });

  it("keeps credential version in the signed JWT and derives the browser session from it", async () => {
    const auth = await options();
    const token = await auth.callbacks.jwt({ token: { name: "kele" }, user: identity });
    expect(token.credentialVersion).toBe(identity.credentialVersion);
    const updated = await auth.callbacks.jwt({ token, trigger: "update", session: { credentialVersion: "forged" } });
    expect(updated.credentialVersion).toBe(identity.credentialVersion);
    const session = await auth.callbacks.session({ session: { user: { name: "kele" } }, token });
    expect(session.user.credentialVersion).toBe(identity.credentialVersion);
  });
});

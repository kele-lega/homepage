// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const { signIn } = vi.hoisted(() => ({ signIn: vi.fn() }));
vi.mock("next-auth/react", () => ({ signIn }));
vi.mock("next/router", () => ({ useRouter: () => ({ query: { callbackUrl: "/?tab=home" } }) }));
vi.mock("utils/config/config", () => ({ getSettings: () => ({ title: "Dashboard", providers: { secret: "hidden" } }) }));
vi.mock("pages/api/auth/[...nextauth]", () => ({ authOptions: { providers: [{ id: "credentials", name: "Password", type: "credentials" }] } }));

import SignInPage, { getServerSideProps } from "pages/auth/signin";
const providers = { credentials: { id: "credentials", name: "Password", type: "credentials" } };
afterEach(() => vi.unstubAllEnvs());

it("submits username and password through the native signIn flow", () => {
  render(<SignInPage providers={providers} settings={{ title: "Dashboard" }} multiUser />);
  fireEvent.change(screen.getByLabelText("Username"), { target: { value: "kele" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "test-password" } });
  fireEvent.submit(screen.getByRole("button", { name: /Sign in/ }).closest("form"));
  expect(signIn).toHaveBeenCalledWith("credentials", { redirect: true, callbackUrl: "/?tab=home", username: "kele", password: "test-password" });
});

it("keeps the upstream password-only form when no adapter is configured", () => {
  render(<SignInPage providers={providers} settings={{}} />);
  expect(screen.queryByLabelText("Username")).not.toBeInTheDocument();
});

it("passes only the multi-user flag, never verifier credentials, to the public page", async () => {
  vi.stubEnv("HOMEPAGE_CREDENTIALS_URL", "http://internal-secret-host/verify");
  vi.stubEnv("HOMEPAGE_CREDENTIALS_SECRET", "private-secret");
  const result = await getServerSideProps({});
  expect(result.props.multiUser).toBe(true);
  expect(JSON.stringify(result)).not.toMatch(/private-secret|internal-secret-host|hidden/);
});

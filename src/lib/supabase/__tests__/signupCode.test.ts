import { describe, it, expect, vi, beforeEach } from "vitest";

/** Confirming a new account with the code from the email (Nov 2026). */

const calls: { type: string; token: string; email: string }[] = [];
let accept: string | null = "email";

vi.mock("../client", () => ({
  supabase: {
    auth: {
      verifyOtp: (args: { type: string; token: string; email: string }) => {
        calls.push(args);
        return Promise.resolve(
          args.type === accept
            ? { data: { session: { access_token: "t" }, user: { id: "u" } }, error: null }
            : { data: { session: null, user: null }, error: { message: "Token has expired or is invalid" } },
        );
      },
    },
  },
}));

import { verifySignupCode } from "../auth";

beforeEach(() => {
  calls.length = 0;
  accept = "email";
});

describe("verifySignupCode", () => {
  it("confirms with type 'email', digits only", async () => {
    const out = await verifySignupCode("a@b.id", " 123 456 ");
    expect(out.session).toBeTruthy();
    expect(calls).toEqual([{ email: "a@b.id", token: "123456", type: "email" }]);
  });

  it("falls back to type 'signup' for older servers", async () => {
    accept = "signup";
    await verifySignupCode("a@b.id", "123456");
    expect(calls.map((c) => c.type)).toEqual(["email", "signup"]);
  });

  it("a wrong code throws the server's message", async () => {
    accept = null;
    await expect(verifySignupCode("a@b.id", "000000")).rejects.toMatchObject({ message: "Token has expired or is invalid" });
  });
});

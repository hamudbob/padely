import { describe, it, expect } from "vitest";
import { serverReason } from "../errorReporter";

/** 15 Oct 2026: the reason was in the response, the log showed only "400". */
describe("serverReason", () => {
  it("PostgREST's message", () => {
    expect(serverReason('{"code":"P0001","details":null,"hint":null,"message":"Could not find your team."}'))
      .toBe("Could not find your team.");
  });
  it("GoTrue's msg / error_description", () => {
    expect(serverReason('{"code":400,"msg":"Email not confirmed"}')).toBe("Email not confirmed");
    expect(serverReason('{"error":"invalid_grant","error_description":"Invalid login credentials"}')).toBe("Invalid login credentials");
  });
  it("plain text is kept, HTML and empty bodies are not", () => {
    expect(serverReason("upstream timeout")).toBe("upstream timeout");
    expect(serverReason("<html><body>502</body></html>")).toBeNull();
    expect(serverReason("")).toBeNull();
  });
});

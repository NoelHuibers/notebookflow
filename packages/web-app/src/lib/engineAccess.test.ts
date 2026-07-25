import { describe, expect, it } from "vitest";

import { EngineRequestError } from "@/lib/EngineClient";
import { canRunPipeline, isEngineCredentialsError } from "@/lib/engineAccess";

describe("canRunPipeline", () => {
  it("allows signed-in users on the hosted engine", () => {
    expect(canRunPipeline(true, false)).toBe(true);
    expect(canRunPipeline(true, true)).toBe(true);
  });

  it("blocks signed-out visitors targeting the hosted engine", () => {
    expect(canRunPipeline(false, false)).toBe(false);
    expect(canRunPipeline(false, false, false)).toBe(false);
  });

  it("allows signed-out runs against a bring-your-own engine override", () => {
    expect(canRunPipeline(false, true)).toBe(true);
  });

  it("allows signed-out runs when a static self-host engine token is configured", () => {
    expect(canRunPipeline(false, false, true)).toBe(true);
  });
});

describe("isEngineCredentialsError", () => {
  it("matches an EngineRequestError with status 401", () => {
    expect(isEngineCredentialsError(new EngineRequestError("credentials required", 401))).toBe(
      true,
    );
  });

  it("ignores other engine statuses", () => {
    expect(isEngineCredentialsError(new EngineRequestError("rate limited", 429))).toBe(false);
    expect(isEngineCredentialsError(new EngineRequestError("boom", 500))).toBe(false);
  });

  it("ignores non-engine errors", () => {
    expect(isEngineCredentialsError(new Error("network down"))).toBe(false);
    expect(isEngineCredentialsError(undefined)).toBe(false);
    expect(isEngineCredentialsError("401")).toBe(false);
  });
});

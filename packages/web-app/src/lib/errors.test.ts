import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";

import { formatError, LocalizableError } from "./errors";

const t = ((key: string, params?: Record<string, string | number>) =>
  params === undefined ? key : `${key} ${JSON.stringify(params)}`) as unknown as TFunction;

describe("formatError", () => {
  it("resolves a LocalizableError through the catalog with its params", () => {
    const err = new LocalizableError("app.errors.notValidJson", { message: "boom" });
    expect(formatError(t, err)).toBe('app.errors.notValidJson {"message":"boom"}');
  });

  it("keeps a plain Error's message", () => {
    expect(formatError(t, new Error("plain"))).toBe("plain");
  });

  it("falls back to the unknown key for non-Error values", () => {
    expect(formatError(t, "nope")).toBe("app.errors.unknown");
  });

  it("honors a custom fallback key", () => {
    expect(formatError(t, undefined, "app.errors.cloudSaveFailed")).toBe(
      "app.errors.cloudSaveFailed",
    );
  });
});

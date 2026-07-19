import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import type { AccountDataExport } from "@/types/account";
import {
  buildAccountExportArchive,
  isAccountDeleteConfirmed,
  safeArchiveSegment,
} from "./accountDataApi";

const exportedAt = "2026-07-19T12:00:00.000Z";
const accountData: AccountDataExport = {
  version: 1,
  exportedAt,
  account: {
    id: "user-1",
    name: "Ada",
    email: "ada@example.com",
    emailVerified: true,
    image: null,
    createdAt: exportedAt,
    updatedAt: exportedAt,
  },
  connections: [],
  sessions: [],
  notebooks: [
    {
      id: "notebook-1",
      name: "../sales:Q1",
      content: '{"version":2,"files":[]}',
      createdAt: exportedAt,
      updatedAt: exportedAt,
    },
  ],
  providerKey: {
    provider: "anthropic",
    model: "claude",
    createdAt: exportedAt,
    updatedAt: exportedAt,
    secretIncluded: false,
  },
  excludedSecrets: ["session tokens"],
};

describe("account data export", () => {
  it("requires the signed-in email exactly, ignoring case and outer whitespace", () => {
    expect(isAccountDeleteConfirmed(" ADA@example.com ", "ada@example.com")).toBe(true);
    expect(isAccountDeleteConfirmed("delete", "ada@example.com")).toBe(false);
  });

  it("keeps archive segments flat and portable", () => {
    expect(safeArchiveSegment("../../Q1:sales?.csv")).toBe("Q1-sales-.csv");
    expect(safeArchiveSegment("..")).toBe("item");
  });

  it("bundles account metadata, saved notebooks, and uploaded file bytes", async () => {
    const blob = await buildAccountExportArchive(accountData, [
      { name: "orders.csv", size: 8, content: new Blob(["a,b\n1,2\n"]) },
    ]);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());

    expect(Object.keys(zip.files).sort()).toEqual([
      "data-files/",
      "data-files/orders.csv",
      "notebookflow-account.json",
      "notebooks/",
      "notebooks/sales-Q1-notebook-1.notebookflow.json",
    ]);
    expect(await zip.file("data-files/orders.csv")?.async("string")).toBe("a,b\n1,2\n");
    expect(await zip.file("notebooks/sales-Q1-notebook-1.notebookflow.json")?.async("string")).toBe(
      accountData.notebooks[0]?.content,
    );

    const manifest = JSON.parse(
      (await zip.file("notebookflow-account.json")?.async("string")) ?? "{}",
    ) as AccountDataExport & { dataFiles: Array<{ name: string; size: number }> };
    expect(manifest.account.email).toBe("ada@example.com");
    expect(manifest.providerKey?.secretIncluded).toBe(false);
    expect(manifest.dataFiles).toEqual([{ name: "orders.csv", size: 8 }]);
  });
});

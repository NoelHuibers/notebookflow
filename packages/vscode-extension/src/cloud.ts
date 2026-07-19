/**
 * Cloud account integration (#88) — OPTIONAL sign-in to the hosted
 * NotebookFlow web app via the OAuth device-authorization flow, plus the
 * additive cloud-notebook commands. Everything here runs HOST-SIDE (the
 * extension host Node process): the webview CSP blocks remote fetch, and
 * the host is also where SecretStorage lives.
 *
 * Product constraints:
 *   - Signed-out keeps today's behavior exactly; nothing here gates or nags.
 *   - This module talks to the web app's origin ONLY (cloud.baseUrl). The
 *     engine keeps its own local URL/token plumbing — pipeline execution
 *     never touches the cloud.
 */

import {
  CloudClient,
  CloudRequestError,
  parseWorkspace,
  serializeWorkspace,
  type WorkspaceFile,
} from "@notebookflow/app-core";
import * as vscode from "vscode";

/** SecretStorage key holding the cloud bearer token from the device flow. */
export const CLOUD_TOKEN_SECRET = "notebookflow.cloudToken";

/** Device-authorization client identifier allow-listed by the server. */
const DEVICE_CLIENT_ID = "notebookflow-vscode";

const DEFAULT_BASE_URL = "https://notebookflow.app";

const SIGN_IN_COMMAND = "notebookflow.cloudSignIn";

/** Base URL of the hosted web app (setting, default https://notebookflow.app). */
export function getCloudBaseUrl(): string {
  const config = vscode.workspace.getConfiguration("notebookflow");
  const url = config.get<string>("cloud.baseUrl", DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
  return url === "" ? DEFAULT_BASE_URL : url;
}

// ---------------------------------------------------------------------------
// Device-authorization flow (RFC 8628 against better-auth's device plugin).
// ---------------------------------------------------------------------------

interface DeviceCodeGrant {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  /** Polling interval in seconds. */
  interval: number;
  /** Grant lifetime in seconds. */
  expiresIn: number;
}

/** Thrown when the user cancels the polling notification — not an error. */
class SignInCancelledError extends Error {
  constructor() {
    super("sign-in cancelled");
    this.name = "SignInCancelledError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "unknown error";
}

async function requestDeviceCode(baseUrl: string): Promise<DeviceCodeGrant> {
  const res = await fetch(`${baseUrl}/api/auth/device/code`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: DEVICE_CLIENT_ID }),
  });
  if (!res.ok) {
    throw new Error(`device code request failed with status ${String(res.status)}`);
  }
  const payload: unknown = await res.json();
  if (!isRecord(payload)) {
    throw new Error("device code response was not an object");
  }
  const candidate: {
    device_code?: unknown;
    user_code?: unknown;
    verification_uri?: unknown;
    verification_uri_complete?: unknown;
    interval?: unknown;
    expires_in?: unknown;
  } = payload;
  if (typeof candidate.device_code !== "string" || typeof candidate.user_code !== "string") {
    throw new Error("device code response was missing device_code/user_code");
  }
  return {
    deviceCode: candidate.device_code,
    userCode: candidate.user_code,
    verificationUri:
      typeof candidate.verification_uri_complete === "string"
        ? candidate.verification_uri_complete
        : typeof candidate.verification_uri === "string"
          ? candidate.verification_uri
          : `${baseUrl}/device`,
    interval:
      typeof candidate.interval === "number" && candidate.interval > 0 ? candidate.interval : 5,
    expiresIn:
      typeof candidate.expires_in === "number" && candidate.expires_in > 0
        ? candidate.expires_in
        : 900,
  };
}

/** Cancellation-aware sleep; resolves early (without throwing) on cancel. */
function delay(ms: number, cancel: vscode.CancellationToken): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      subscription.dispose();
      resolve();
    }, ms);
    const subscription = cancel.onCancellationRequested(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * Poll the token endpoint until the user approves in the browser. Handles
 * `authorization_pending` (keep going), `slow_down` (back off by 5s), and
 * turns `expired_token` / `access_denied` into user-readable errors.
 */
async function pollDeviceToken(
  baseUrl: string,
  grant: DeviceCodeGrant,
  cancel: vscode.CancellationToken,
): Promise<string> {
  const deadline = Date.now() + grant.expiresIn * 1000;
  let intervalSeconds = grant.interval;
  while (Date.now() < deadline) {
    await delay(intervalSeconds * 1000, cancel);
    if (cancel.isCancellationRequested) {
      throw new SignInCancelledError();
    }
    const res = await fetch(`${baseUrl}/api/auth/device/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: grant.deviceCode,
        client_id: DEVICE_CLIENT_ID,
      }),
    });
    let payload: unknown = null;
    try {
      payload = await res.json();
    } catch {
      // Non-JSON response — fall through to the protocol error below.
    }
    const record: { access_token?: unknown; error?: unknown } = isRecord(payload) ? payload : {};
    const accessToken = record.access_token;
    if (res.ok && typeof accessToken === "string" && accessToken !== "") {
      return accessToken;
    }
    const error = typeof record.error === "string" ? record.error : "";
    if (error === "authorization_pending") {
      continue;
    }
    if (error === "slow_down") {
      intervalSeconds += 5;
      continue;
    }
    if (error === "expired_token") {
      throw new Error("the sign-in code expired before it was approved. Run the command again.");
    }
    if (error === "access_denied") {
      throw new Error("the sign-in was denied in the browser.");
    }
    throw new Error(`unexpected response from the sign-in endpoint (status ${String(res.status)})`);
  }
  throw new Error("the sign-in code expired before it was approved. Run the command again.");
}

// ---------------------------------------------------------------------------
// Commands.
// ---------------------------------------------------------------------------

export async function cloudSignIn(context: vscode.ExtensionContext): Promise<void> {
  const baseUrl = getCloudBaseUrl();
  let grant: DeviceCodeGrant;
  try {
    grant = await requestDeviceCode(baseUrl);
  } catch (err: unknown) {
    void vscode.window.showErrorMessage(
      `NotebookFlow: could not start cloud sign-in — ${errorMessage(err)}`,
    );
    return;
  }

  await vscode.env.clipboard.writeText(grant.userCode);
  const choice = await vscode.window.showInformationMessage(
    `NotebookFlow: your sign-in code is ${grant.userCode}`,
    {
      modal: true,
      detail:
        "The code was copied to the clipboard. Approve the sign-in in your browser — VS Code keeps polling in the background until you do (cancellable from the progress notification).",
    },
    "Open Browser",
  );
  if (choice === "Open Browser") {
    void vscode.env.openExternal(vscode.Uri.parse(grant.verificationUri));
  }

  try {
    const token = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "NotebookFlow: waiting for browser approval…",
        cancellable: true,
      },
      (_progress, cancel) => pollDeviceToken(baseUrl, grant, cancel),
    );
    await context.secrets.store(CLOUD_TOKEN_SECRET, token);
    void vscode.window.showInformationMessage("NotebookFlow: signed in to NotebookFlow Cloud.");
  } catch (err: unknown) {
    if (err instanceof SignInCancelledError) {
      return;
    }
    void vscode.window.showErrorMessage(
      `NotebookFlow: cloud sign-in failed — ${errorMessage(err)}`,
    );
  }
}

export async function cloudSignOut(context: vscode.ExtensionContext): Promise<void> {
  await context.secrets.delete(CLOUD_TOKEN_SECRET);
  void vscode.window.showInformationMessage("NotebookFlow: signed out of NotebookFlow Cloud.");
}

/**
 * Offer sign-in when a cloud command runs without a token. Never auto-starts
 * the flow — sign-in stays a deliberate user action.
 */
async function offerSignIn(): Promise<void> {
  const choice = await vscode.window.showInformationMessage(
    "NotebookFlow: sign in to NotebookFlow Cloud to use your saved notebooks.",
    "Sign In",
  );
  if (choice === "Sign In") {
    void vscode.commands.executeCommand(SIGN_IN_COMMAND);
  }
}

function showCloudError(operation: string, err: unknown): void {
  if (err instanceof CloudRequestError && err.status === 401) {
    void vscode.window.showErrorMessage(
      `NotebookFlow: ${operation} failed — your cloud session expired. Sign in again.`,
    );
    return;
  }
  void vscode.window.showErrorMessage(`NotebookFlow: ${operation} failed — ${errorMessage(err)}`);
}

function ipynbFileName(name: string): string {
  const flat = name.replace(/[\\/]/g, "_");
  return flat.toLowerCase().endsWith(".ipynb") ? flat : `${flat}.ipynb`;
}

export async function openCloudNotebook(context: vscode.ExtensionContext): Promise<void> {
  const token = (await context.secrets.get(CLOUD_TOKEN_SECRET)) ?? "";
  if (token === "") {
    await offerSignIn();
    return;
  }
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (folder === undefined) {
    void vscode.window.showErrorMessage(
      "NotebookFlow: open a folder first — cloud notebooks are written into the first workspace folder.",
    );
    return;
  }

  const client = new CloudClient(getCloudBaseUrl(), token);
  let picked: { label: string; description: string; id: string } | undefined;
  try {
    const notebooks = await client.listNotebooks();
    if (notebooks.length === 0) {
      void vscode.window.showInformationMessage(
        "NotebookFlow: no cloud notebooks saved yet. Use “Save Notebook to Cloud” or the web app to create one.",
      );
      return;
    }
    picked = await vscode.window.showQuickPick(
      notebooks.map((nb) => ({
        label: nb.name,
        description: new Date(nb.updatedAt).toLocaleString(),
        id: nb.id,
      })),
      { title: "NotebookFlow: Open Cloud Notebook", placeHolder: "Pick a cloud notebook" },
    );
  } catch (err: unknown) {
    showCloudError("listing cloud notebooks", err);
    return;
  }
  if (picked === undefined) {
    return; // cancelled
  }

  let files: WorkspaceFile[];
  try {
    const record = await client.getNotebook(picked.id);
    files = parseWorkspace(record.content).files;
  } catch (err: unknown) {
    showCloudError("opening the cloud notebook", err);
    return;
  }

  const targets = files.map((file) => ({
    file,
    uri: vscode.Uri.joinPath(folder.uri, ipynbFileName(file.name)),
  }));
  const existing: string[] = [];
  for (const target of targets) {
    try {
      await vscode.workspace.fs.stat(target.uri);
      existing.push(ipynbFileName(target.file.name));
    } catch {
      // Does not exist yet — safe to write.
    }
  }
  if (existing.length > 0) {
    const confirm = await vscode.window.showWarningMessage(
      `NotebookFlow: overwrite ${existing.join(", ")}?`,
      {
        modal: true,
        detail: "These files already exist in the workspace folder and will be replaced.",
      },
      "Overwrite",
    );
    if (confirm !== "Overwrite") {
      return;
    }
  }

  try {
    for (const target of targets) {
      await vscode.workspace.fs.writeFile(target.uri, new TextEncoder().encode(target.file.json));
    }
    const first = targets[0];
    if (first !== undefined) {
      const doc = await vscode.workspace.openNotebookDocument(first.uri);
      await vscode.window.showNotebookDocument(doc);
    }
  } catch (err: unknown) {
    showCloudError("writing the notebook files", err);
  }
}

export async function saveNotebookToCloud(context: vscode.ExtensionContext): Promise<void> {
  const token = (await context.secrets.get(CLOUD_TOKEN_SECRET)) ?? "";
  if (token === "") {
    await offerSignIn();
    return;
  }
  const editor = vscode.window.activeNotebookEditor;
  if (editor === undefined) {
    void vscode.window.showErrorMessage(
      "NotebookFlow: open a Jupyter notebook before running this command.",
    );
    return;
  }

  const doc = editor.notebook;
  const name = doc.uri.path.split("/").pop() ?? "notebook.ipynb";
  const content = serializeWorkspace([{ name, json: serializeNotebookDocument(doc) }]);
  const client = new CloudClient(getCloudBaseUrl(), token);
  try {
    // Follow-up: always creates a new cloud notebook — no update/overwrite of
    // an existing cloud entry yet.
    const created = await client.createNotebook(name, content);
    void vscode.window.showInformationMessage(
      `NotebookFlow: saved to NotebookFlow Cloud as “${created.name}”.`,
    );
  } catch (err: unknown) {
    showCloudError("saving to the cloud", err);
  }
}

/** QuickPick behind the status bar item: sign in/out + the cloud commands. */
export async function cloudStatusPicker(context: vscode.ExtensionContext): Promise<void> {
  const signedIn = ((await context.secrets.get(CLOUD_TOKEN_SECRET)) ?? "") !== "";
  const items = signedIn
    ? ["Open Cloud Notebook", "Save Notebook to Cloud", "Sign Out"]
    : ["Sign In"];
  const picked = await vscode.window.showQuickPick(items, { title: "NotebookFlow Cloud" });
  if (picked === "Sign In") {
    await cloudSignIn(context);
  } else if (picked === "Sign Out") {
    await cloudSignOut(context);
  } else if (picked === "Open Cloud Notebook") {
    await openCloudNotebook(context);
  } else if (picked === "Save Notebook to Cloud") {
    await saveNotebookToCloud(context);
  }
}

// ---------------------------------------------------------------------------
// nbformat serialization of a VS Code NotebookDocument.
// ---------------------------------------------------------------------------

/**
 * Serialize a NotebookDocument to nbformat-v4 JSON — the same shape as the
 * repo's `.ipynb` files and what the web app's workspace parser ingests.
 * Outputs are intentionally dropped (matches the web app's export, which
 * writes `outputs: []` for code cells).
 *
 * Handles both metadata layouts of the Jupyter extension: the legacy
 * `{ custom: { metadata, nbformat, … } }` nesting and the modern flat shape.
 */
export function serializeNotebookDocument(doc: vscode.NotebookDocument): string {
  const root: Record<string, unknown> = isRecord(doc.metadata) ? doc.metadata : {};
  const rootCustom = (root as { custom?: unknown }).custom;
  const custom: { metadata?: unknown; nbformat?: unknown; nbformat_minor?: unknown } = isRecord(
    rootCustom,
  )
    ? rootCustom
    : root;
  const metadata = isRecord(custom.metadata) ? custom.metadata : {};
  const nbformat = typeof custom.nbformat === "number" ? custom.nbformat : 4;
  const nbformatMinor = typeof custom.nbformat_minor === "number" ? custom.nbformat_minor : 5;

  const cells = doc.getCells().map((cell) => {
    const cellMetadata: Record<string, unknown> = isRecord(cell.metadata) ? cell.metadata : {};
    const source = cell.document.getText();
    if (cell.kind === vscode.NotebookCellKind.Code) {
      // The Jupyter extension represents raw cells as code cells with the
      // "raw" language — round-trip them as nbformat raw cells.
      if (cell.document.languageId === "raw") {
        return { cell_type: "raw", metadata: cellMetadata, source };
      }
      return {
        cell_type: "code",
        execution_count: null,
        metadata: cellMetadata,
        outputs: [],
        source,
      };
    }
    return { cell_type: "markdown", metadata: cellMetadata, source };
  });

  return JSON.stringify({ cells, metadata, nbformat, nbformat_minor: nbformatMinor });
}

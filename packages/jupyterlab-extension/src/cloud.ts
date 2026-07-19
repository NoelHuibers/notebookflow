/**
 * Cloud account integration (#88) — OPTIONAL sign-in to the hosted
 * NotebookFlow web app, plus the additive cloud-notebook commands
 * (open/save) and the small Cloud menu behind the SplitView header button.
 *
 * Product constraints:
 *   - Signed-out keeps today's behavior exactly; nothing here gates or nags.
 *   - Requests go to the web app origin ONLY (`cloudBaseUrl` setting). The
 *     engine keeps its own local URL plumbing — pipeline execution never
 *     touches the cloud.
 *
 * The token lives in the plugin settings (`cloudToken`, same plain-text
 * caveat as `llmApiKey`), written via the SettingsAccessor's `set` seam.
 */

import type { JupyterFrontEnd } from "@jupyterlab/application";
import type { ICommandPalette } from "@jupyterlab/apputils";
import { Dialog, InputDialog, Notification, showDialog } from "@jupyterlab/apputils";
import type { INotebookTracker } from "@jupyterlab/notebook";
import type { Contents } from "@jupyterlab/services";
import {
  CloudClient,
  CloudRequestError,
  parseWorkspace,
  serializeWorkspace,
} from "@notebookflow/app-core";

import { joinContentsPath, notebookDirname } from "./dataFiles";
import { DeviceAuthError, pollDeviceToken, requestDeviceCode } from "./deviceAuth";
import type { SettingsAccessor } from "./settings";
import { resolveStrings } from "./strings";

/** Device-authorization client identifier allow-listed by the server. */
const DEVICE_CLIENT_ID = "notebookflow-jupyterlab";

export const CLOUD_COMMANDS = {
  signIn: "notebookflow:cloud-sign-in",
  signOut: "notebookflow:cloud-sign-out",
  openNotebook: "notebookflow:open-cloud-notebook",
  saveNotebook: "notebookflow:save-notebook-to-cloud",
} as const;

const CATEGORY = "NotebookFlow";

export interface CloudCommandOptions {
  app: JupyterFrontEnd;
  tracker: INotebookTracker;
  palette: ICommandPalette;
  settings: SettingsAccessor;
  contents: Contents.IManager;
}

/** Cloud base URL from the setting, normalized (default https://notebookflow.app). */
export function normalizeCloudBaseUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  return trimmed === "" ? "https://notebookflow.app" : trimmed;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "unknown error";
}

function cloudErrorText(err: unknown): string {
  const s = resolveStrings();
  if (err instanceof CloudRequestError && err.status === 401) {
    return s.cloudSessionExpired;
  }
  return s.cloudRequestFailed.replace("{message}", errorMessage(err));
}

function ipynbFileName(name: string): string {
  const flat = name.replace(/[\\/]/g, "_");
  return flat.toLowerCase().endsWith(".ipynb") ? flat : `${flat}.ipynb`;
}

/**
 * Register the cloud commands + palette entries. Returns the opener for the
 * small Cloud menu used by the SplitView header button.
 */
export function registerCloudCommands(options: CloudCommandOptions): {
  openCloudMenu: () => void;
} {
  const { app, tracker, palette, settings, contents } = options;

  const cloudClient = (): CloudClient | null => {
    const { cloudBaseUrl, cloudToken } = settings.get();
    const token = cloudToken.trim();
    if (token === "") {
      Notification.warning(resolveStrings().cloudSignInRequired, { autoClose: 8000 });
      return null;
    }
    return new CloudClient(normalizeCloudBaseUrl(cloudBaseUrl), token);
  };

  const signIn = async (): Promise<void> => {
    const s = resolveStrings();
    const baseUrl = normalizeCloudBaseUrl(settings.get().cloudBaseUrl);
    let grant: Awaited<ReturnType<typeof requestDeviceCode>>;
    try {
      grant = await requestDeviceCode(baseUrl, DEVICE_CLIENT_ID);
    } catch (err: unknown) {
      Notification.error(s.cloudSignInFailed.replace("{message}", errorMessage(err)), {
        autoClose: 8000,
      });
      return;
    }

    const result = await showDialog({
      title: s.cloudSignInTitle,
      body: s.cloudSignInBody.replace("{code}", grant.userCode),
      buttons: [Dialog.cancelButton(), Dialog.okButton({ label: s.cloudOpenBrowser })],
    });
    if (!result.button.accept) {
      return;
    }
    window.open(grant.verificationUri, "_blank", "noopener");

    const id = Notification.emit(s.cloudWaiting, "in-progress", { autoClose: false });
    try {
      const token = await pollDeviceToken(baseUrl, DEVICE_CLIENT_ID, grant);
      await settings.set("cloudToken", token);
      Notification.update({ id, message: s.cloudSignedIn, type: "success", autoClose: 5000 });
    } catch (err: unknown) {
      let message = s.cloudSignInFailed.replace("{message}", errorMessage(err));
      if (err instanceof DeviceAuthError && err.code === "expired") {
        message = s.cloudSignInExpired;
      } else if (err instanceof DeviceAuthError && err.code === "denied") {
        message = s.cloudSignInDenied;
      }
      Notification.update({ id, message, type: "error", autoClose: 8000 });
    }
  };

  const signOut = async (): Promise<void> => {
    await settings.set("cloudToken", "");
    Notification.success(resolveStrings().cloudSignedOut, { autoClose: 5000 });
  };

  const openCloudNotebook = async (): Promise<void> => {
    const s = resolveStrings();
    const client = cloudClient();
    if (client === null) {
      return;
    }
    try {
      const notebooks = await client.listNotebooks();
      if (notebooks.length === 0) {
        Notification.info(s.cloudNoNotebooks, { autoClose: 5000 });
        return;
      }
      const labels = notebooks.map(
        (nb) => `${nb.name} — ${new Date(nb.updatedAt).toLocaleString()}`,
      );
      const choice = await InputDialog.getItem({
        title: s.cloudMenuTitle,
        label: s.cloudPickNotebook,
        items: labels,
        editable: false,
      });
      if (!choice.button.accept || choice.value === null) {
        return;
      }
      const summary = notebooks[labels.indexOf(choice.value)];
      if (summary === undefined) {
        return;
      }

      const record = await client.getNotebook(summary.id);
      const workspace = parseWorkspace(record.content);
      // Files land next to the current notebook (server root when none open).
      const dir =
        tracker.currentWidget === null ? "" : notebookDirname(tracker.currentWidget.context.path);
      let firstPath: string | null = null;
      for (const file of workspace.files) {
        const path = joinContentsPath(dir, ipynbFileName(file.name));
        await contents.save(path, {
          type: "notebook",
          format: "json",
          content: JSON.parse(file.json) as unknown,
        });
        firstPath = firstPath ?? path;
      }
      if (firstPath !== null) {
        await app.commands.execute("docmanager:open", { path: firstPath });
      }
      Notification.success(s.cloudOpened.replace("{name}", summary.name), { autoClose: 5000 });
    } catch (err: unknown) {
      Notification.error(cloudErrorText(err), { autoClose: 8000 });
    }
  };

  const saveNotebookToCloud = async (): Promise<void> => {
    const s = resolveStrings();
    const panel = tracker.currentWidget;
    if (panel === null) {
      Notification.warning(s.cloudNoNotebookOpen, { autoClose: 5000 });
      return;
    }
    const client = cloudClient();
    if (client === null) {
      return;
    }
    try {
      // Raw nbformat JSON of the file as saved on the Jupyter server.
      const model = await contents.get(panel.context.path, { content: true });
      const name = panel.context.path.split("/").pop() ?? "notebook.ipynb";
      const json = JSON.stringify(model.content);
      // Follow-up: always creates a new cloud notebook — no update/overwrite
      // of an existing cloud entry yet.
      const created = await client.createNotebook(name, serializeWorkspace([{ name, json }]));
      Notification.success(s.cloudSaved.replace("{name}", created.name), { autoClose: 5000 });
    } catch (err: unknown) {
      Notification.error(cloudErrorText(err), { autoClose: 8000 });
    }
  };

  app.commands.addCommand(CLOUD_COMMANDS.signIn, {
    label: "NotebookFlow: Sign in to NotebookFlow Cloud",
    caption: "Optional: sign in to the hosted NotebookFlow web app via your browser.",
    execute: () => signIn(),
  });
  app.commands.addCommand(CLOUD_COMMANDS.signOut, {
    label: "NotebookFlow: Sign out of NotebookFlow Cloud",
    caption: "Clear the stored NotebookFlow Cloud access token.",
    execute: () => signOut(),
  });
  app.commands.addCommand(CLOUD_COMMANDS.openNotebook, {
    label: "NotebookFlow: Open Cloud Notebook",
    caption: "Download one of your cloud notebooks next to the current notebook and open it.",
    execute: () => openCloudNotebook(),
  });
  app.commands.addCommand(CLOUD_COMMANDS.saveNotebook, {
    label: "NotebookFlow: Save Notebook to Cloud",
    caption: "Save the current notebook to your NotebookFlow Cloud account.",
    isEnabled: () => tracker.currentWidget !== null,
    execute: () => saveNotebookToCloud(),
  });
  for (const command of Object.values(CLOUD_COMMANDS)) {
    palette.addItem({ command, category: CATEGORY });
  }

  const openCloudMenu = (): void => {
    void (async (): Promise<void> => {
      const s = resolveStrings();
      const signedIn = settings.get().cloudToken.trim() !== "";
      const items = signedIn
        ? [s.cloudMenuOpen, s.cloudMenuSave, s.cloudMenuSignOut]
        : [s.cloudMenuSignIn];
      const choice = await InputDialog.getItem({
        title: s.cloudMenuTitle,
        label: s.cloudMenuLabel,
        items,
        editable: false,
      });
      if (!choice.button.accept || choice.value === null) {
        return;
      }
      if (choice.value === s.cloudMenuSignIn) {
        await signIn();
      } else if (choice.value === s.cloudMenuSignOut) {
        await signOut();
      } else if (choice.value === s.cloudMenuOpen) {
        await openCloudNotebook();
      } else if (choice.value === s.cloudMenuSave) {
        await saveNotebookToCloud();
      }
    })();
  };

  return { openCloudMenu };
}

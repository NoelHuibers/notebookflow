/**
 * File System Access API helpers.
 *
 * `window.showSaveFilePicker` isn't in lib.dom.d.ts yet (Chromium-only at
 * the time of writing), so this module wraps it behind a typed shim with
 * feature detection. Callers should gate UI on `canSaveInPlace`.
 */

interface FilePickerAcceptType {
  description?: string;
  accept: Record<string, string[]>;
}

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: FilePickerAcceptType[];
}

interface WindowWithFSA {
  showSaveFilePicker?: (options: SaveFilePickerOptions) => Promise<FileSystemFileHandle>;
}

export const canSaveInPlace = typeof window !== "undefined" && "showSaveFilePicker" in window;

/** Open the native save picker. Returns null if the API is unavailable. */
export async function pickSaveFileHandle(
  options: SaveFilePickerOptions,
): Promise<FileSystemFileHandle | null> {
  const fn = (window as WindowWithFSA).showSaveFilePicker;
  if (fn === undefined) {
    return null;
  }
  return fn(options);
}

/** Write a string payload to a previously-picked file handle. */
export async function writeFileHandle(handle: FileSystemFileHandle, data: string): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(data);
  await writable.close();
}

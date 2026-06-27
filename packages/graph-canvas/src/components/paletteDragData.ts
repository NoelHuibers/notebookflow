import { NODE_DRAG_MIME } from "./nodeDragMime";

const FALLBACK_MIME = "text/plain";
const FALLBACK_PREFIX = "notebookflow-manifest:";

/** Set drag payload for a palette manifest (custom MIME + VS Code webview fallback). */
export function setPaletteDragData(dataTransfer: DataTransfer, manifestId: string): void {
  dataTransfer.setData(NODE_DRAG_MIME, manifestId);
  dataTransfer.setData(FALLBACK_MIME, `${FALLBACK_PREFIX}${manifestId}`);
  dataTransfer.effectAllowed = "copy";
}

/** True when the drag carries a palette manifest id. */
export function isPaletteDrag(dataTransfer: DataTransfer | null): boolean {
  if (dataTransfer === null) {
    return false;
  }
  const types = Array.from(dataTransfer.types);
  if (types.includes(NODE_DRAG_MIME)) {
    return true;
  }
  return types.includes(FALLBACK_MIME);
}

/** Read the manifest id from a palette drop event. */
export function readPaletteDragManifestId(dataTransfer: DataTransfer): string {
  const fromCustom = dataTransfer.getData(NODE_DRAG_MIME);
  if (fromCustom !== "") {
    return fromCustom;
  }
  const plain = dataTransfer.getData(FALLBACK_MIME);
  if (plain.startsWith(FALLBACK_PREFIX)) {
    return plain.slice(FALLBACK_PREFIX.length);
  }
  return "";
}

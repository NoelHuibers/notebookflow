/**
 * JupyterLab handoff — open the active notebook in a running JupyterLab.
 */

export function openInJupyterLab(baseUrl: string, notebookName: string): void {
  const trimmedBase = baseUrl.replace(/\/+$/, "");
  const safeName = notebookName.split("/").map(encodeURIComponent).join("/");
  const target = `${trimmedBase}/lab/tree/${safeName}`;
  window.open(target, "_blank", "noopener,noreferrer");
}

/**
 * Standalone web app — root React component.
 *
 * Mounts the shared graph canvas and connects to a remote FastAPI engine
 * (configured via `VITE_NOTEBOOKFLOW_ENGINE_URL`). Best for demos and
 * sharing read-mostly pipelines; no local kernel.
 */

import type { ReactElement } from "react";

export function App(): ReactElement {
  // TODO: open WebSocket to engine, render <Canvas graph={...} />,
  //   surface a notebook list / file picker.
  throw new Error("web-app App: not implemented");
}

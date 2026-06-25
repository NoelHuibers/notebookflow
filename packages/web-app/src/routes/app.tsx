import { ClientOnly, createFileRoute } from "@tanstack/react-router";

import { App } from "@/App";

export const Route = createFileRoute("/app")({
  component: AppRoute,
});

// The editor is a heavy, browser-only island (React Flow, CodeMirror, the
// WebSocket EngineClient, File System Access). ClientOnly skips SSR for it and
// renders a fallback on the server / during hydration.
function AppRoute() {
  return (
    <ClientOnly fallback={<EditorFallback />}>
      <App />
    </ClientOnly>
  );
}

function EditorFallback() {
  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "system-ui, sans-serif",
        color: "#52525b",
      }}
    >
      Loading NotebookFlow…
    </div>
  );
}

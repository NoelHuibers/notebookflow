import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";

import "reactflow/dist/style.css";
import "../index.css";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "NotebookFlow" },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body style={{ margin: 0 }}>
        <Outlet />
        <Scripts />
      </body>
    </html>
  );
}

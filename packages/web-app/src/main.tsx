import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "reactflow/dist/style.css";
import "./index.css";

import { App } from "./App";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("web-app: #root element missing from index.html");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

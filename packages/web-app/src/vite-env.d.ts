/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_NOTEBOOKFLOW_ENGINE_URL?: string;
  readonly VITE_NOTEBOOKFLOW_ENGINE_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

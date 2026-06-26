import type { ReactElement } from "react";

/**
 * NotebookFlow mark — a tiny DAG (two inputs merging into one output), echoing
 * the pipeline canvas. Uses `currentColor`, so colour it with `text-primary`.
 */
export function LogoMark({ className }: { className?: string }): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      role="img"
      aria-label="NotebookFlow logo"
    >
      <path
        d="M7 6.5 16 11.2M7 17.5 16 12.8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity="0.55"
      />
      <circle cx="5" cy="6.5" r="2.6" fill="currentColor" />
      <circle cx="5" cy="17.5" r="2.6" fill="currentColor" />
      <circle cx="18" cy="12" r="2.8" fill="currentColor" />
    </svg>
  );
}

/** Mark + wordmark, for headers. */
export function Wordmark({ className }: { className?: string }): ReactElement {
  return (
    <span className={`flex items-center gap-2 ${className ?? ""}`}>
      <LogoMark className="size-5 text-primary" />
      <span className="font-semibold tracking-tight">NotebookFlow</span>
    </span>
  );
}

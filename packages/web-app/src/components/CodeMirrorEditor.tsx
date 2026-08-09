/**
 * CodeMirrorEditor — heavy editor split into its own chunk so the
 * ~480 KB CodeMirror bundle loads on first cell render, not at startup.
 *
 * CellEditor wraps this in React.lazy + Suspense; the fallback is a
 * lightweight read-only pre that shows cell contents immediately.
 *
 * The editor follows the app theme: One Dark in dark mode, CodeMirror's
 * default light theme otherwise. CodeMirror paints its own surface, so it
 * can't inherit the Tailwind tokens the rest of the cell uses.
 */

import { python } from "@codemirror/lang-python";
import { oneDark } from "@codemirror/theme-one-dark";
import CodeMirror from "@uiw/react-codemirror";
import type { ReactElement } from "react";
import { useMemo } from "react";

import { useIsDarkMode } from "@/hooks/useIsDarkMode";

export interface CodeMirrorEditorProps {
  value: string;
  isCode: boolean;
  onChange: (next: string) => void;
}

export default function CodeMirrorEditor({
  value,
  isCode,
  onChange,
}: CodeMirrorEditorProps): ReactElement {
  const extensions = useMemo(() => (isCode ? [python()] : []), [isCode]);
  const isDark = useIsDarkMode();
  return (
    <CodeMirror
      className="notebookflow-codemirror"
      value={value}
      width="100%"
      height="auto"
      minHeight="40px"
      theme={isDark ? oneDark : "light"}
      extensions={extensions}
      onChange={onChange}
      basicSetup={{
        lineNumbers: true,
        foldGutter: false,
        highlightActiveLine: false,
        highlightActiveLineGutter: false,
      }}
    />
  );
}

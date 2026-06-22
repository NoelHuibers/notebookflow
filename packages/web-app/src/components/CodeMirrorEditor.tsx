/**
 * CodeMirrorEditor — heavy editor split into its own chunk so the
 * ~480 KB CodeMirror bundle loads on first cell render, not at startup.
 *
 * CellEditor wraps this in React.lazy + Suspense; the fallback is a
 * lightweight read-only pre that shows cell contents immediately.
 */

import { python } from "@codemirror/lang-python";
import { oneDark } from "@codemirror/theme-one-dark";
import CodeMirror from "@uiw/react-codemirror";
import type { ReactElement } from "react";
import { useMemo } from "react";

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
  return (
    <CodeMirror
      value={value}
      height="auto"
      minHeight="40px"
      theme={oneDark}
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

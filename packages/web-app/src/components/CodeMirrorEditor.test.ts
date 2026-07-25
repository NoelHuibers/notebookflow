/**
 * Regression guard for the "Unrecognized extension value in extension set"
 * production crash: two @codemirror/state instances in the dependency tree
 * make extensions from one instance invalid in the other. EditorState.create
 * performs that validation without a DOM, so this catches lockfile
 * duplication at test time — before it ships.
 */

import { python } from "@codemirror/lang-python";
import { EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { basicSetup } from "@uiw/react-codemirror";
import { describe, expect, it } from "vitest";

describe("CodeMirror extension-set integrity (single @codemirror/state instance)", () => {
  it("accepts the editor's real extension stack", () => {
    const state = EditorState.create({
      doc: "import pandas as pd",
      extensions: [
        basicSetup({
          lineNumbers: true,
          foldGutter: false,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
        }),
        python(),
        oneDark,
      ],
    });
    expect(state.doc.toString()).toBe("import pandas as pd");
  });
});

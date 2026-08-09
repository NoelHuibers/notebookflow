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

const setup = basicSetup({
  lineNumbers: true,
  foldGutter: false,
  highlightActiveLine: false,
  highlightActiveLineGutter: false,
});

describe("CodeMirror extension-set integrity (single @codemirror/state instance)", () => {
  it("accepts the editor's real extension stack", () => {
    const state = EditorState.create({
      doc: "import pandas as pd",
      extensions: [setup, python(), oneDark],
    });
    expect(state.doc.toString()).toBe("import pandas as pd");
  });

  // Light mode passes theme="light" instead of the oneDark extension, so the
  // stack the editor builds there is a distinct one and gets its own guard.
  it("accepts the light-mode extension stack (no oneDark)", () => {
    const state = EditorState.create({
      doc: "import pandas as pd",
      extensions: [setup, python()],
    });
    expect(state.doc.toString()).toBe("import pandas as pd");
  });
});

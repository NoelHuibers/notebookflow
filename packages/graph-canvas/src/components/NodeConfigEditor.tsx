import type { CSSProperties, ReactElement } from "react";

import type { NodeManifestDef } from "../node-config";

export interface NodeConfigEditorProps {
  manifest: NodeManifestDef;
  values: Record<string, string>;
  isDirty: boolean;
  isSubmitting?: boolean;
  isDisabled?: boolean;
  error?: string | null;
  warnings?: string[];
  status?: string | null;
  onChange: (key: string, value: string) => void;
  onSubmit: () => void;
}

const PANEL_BG = "var(--notebookflow-config-bg, var(--card, #ffffff))";
const PANEL_BORDER = "var(--notebookflow-config-border, var(--border, #d1d5db))";
const PANEL_FG = "var(--notebookflow-config-fg, var(--foreground, #111827))";
const PANEL_MUTED = "var(--notebookflow-config-muted, var(--muted-foreground, #6b7280))";
const PANEL_ACCENT = "var(--notebookflow-config-accent, var(--primary, #2563eb))";
const PANEL_ACCENT_FG = "var(--notebookflow-config-accent-fg, var(--primary-foreground, #ffffff))";
const PANEL_FONT =
  "var(--notebookflow-font-family, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif)";

export function NodeConfigEditor(props: NodeConfigEditorProps): ReactElement {
  const {
    manifest,
    values,
    isDirty,
    isSubmitting = false,
    isDisabled = false,
    error = null,
    warnings = [],
    status = null,
    onChange,
    onSubmit,
  } = props;

  const buttonLabel = manifest.generationMode === "llm" ? "Generate node" : "Apply config";

  return (
    <section style={styles.panel}>
      <div style={styles.headerRow}>
        <div>
          <div style={styles.title}>Config</div>
          <div style={styles.subtitle}>
            Managed separately from the node's input and output ports.
          </div>
        </div>
        <span style={styles.modeBadge}>{manifest.generationMode}</span>
      </div>

      {manifest.description !== "" && <p style={styles.description}>{manifest.description}</p>}

      <div style={styles.fields}>
        {manifest.configFields.map((field) => {
          const value = values[field.key] ?? "";
          const inputId = `nodeconfig-${field.key}`;

          return (
            <label key={field.key} htmlFor={inputId} style={styles.fieldLabel}>
              <span style={styles.fieldTitle}>
                {field.label}
                {field.required ? <span style={styles.requiredMark}> *</span> : null}
              </span>
              {field.description !== "" && (
                <span style={styles.fieldDescription}>{field.description}</span>
              )}

              {field.kind === "textarea" ? (
                <textarea
                  id={inputId}
                  value={value}
                  rows={4}
                  disabled={isSubmitting}
                  placeholder={field.placeholder}
                  onChange={(event) => {
                    onChange(field.key, event.target.value);
                  }}
                  style={styles.multilineInput}
                />
              ) : field.kind === "select" ? (
                <select
                  id={inputId}
                  value={value}
                  disabled={isSubmitting}
                  onChange={(event) => {
                    onChange(field.key, event.target.value);
                  }}
                  style={styles.selectInput}
                >
                  {field.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id={inputId}
                  type="text"
                  value={value}
                  disabled={isSubmitting}
                  placeholder={field.placeholder}
                  onChange={(event) => {
                    onChange(field.key, event.target.value);
                  }}
                  style={styles.singleLineInput}
                />
              )}
            </label>
          );
        })}
      </div>

      <div style={styles.footer}>
        <button
          type="button"
          disabled={isDisabled || isSubmitting}
          onClick={onSubmit}
          style={{
            ...styles.submitButton,
            ...(isDisabled || isSubmitting ? styles.submitButtonDisabled : {}),
          }}
        >
          {isSubmitting ? "Updating…" : isDirty ? buttonLabel : "Up to date"}
        </button>
        {status !== null && <div style={styles.status}>{status}</div>}
        {error !== null && <div style={styles.error}>{error}</div>}
        {warnings.map((warning, idx) => (
          <div key={`${warning}-${String(idx)}`} style={styles.warning}>
            {warning}
          </div>
        ))}
      </div>
    </section>
  );
}

const styles = {
  panel: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    padding: 12,
    border: `1px solid ${PANEL_BORDER}`,
    borderRadius: 8,
    background: PANEL_BG,
    color: PANEL_FG,
    fontFamily: PANEL_FONT,
  },
  headerRow: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  title: {
    fontSize: 12,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  },
  subtitle: {
    marginTop: 4,
    fontSize: 11,
    color: PANEL_MUTED,
    lineHeight: 1.4,
  },
  modeBadge: {
    borderRadius: 999,
    border: `1px solid ${PANEL_BORDER}`,
    padding: "2px 8px",
    fontSize: 10,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: PANEL_MUTED,
  },
  description: {
    margin: 0,
    fontSize: 11,
    color: PANEL_MUTED,
    lineHeight: 1.45,
  },
  fields: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  fieldLabel: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  fieldTitle: {
    fontSize: 11,
    fontWeight: 600,
  },
  fieldDescription: {
    fontSize: 11,
    color: PANEL_MUTED,
    lineHeight: 1.4,
  },
  requiredMark: {
    color: "#dc2626",
  },
  singleLineInput: {
    width: "100%",
    borderRadius: 6,
    border: `1px solid ${PANEL_BORDER}`,
    background: PANEL_BG,
    color: PANEL_FG,
    padding: "8px 10px",
    font: "inherit",
    boxSizing: "border-box",
  },
  multilineInput: {
    width: "100%",
    minHeight: 88,
    resize: "vertical",
    borderRadius: 6,
    border: `1px solid ${PANEL_BORDER}`,
    background: PANEL_BG,
    color: PANEL_FG,
    padding: "8px 10px",
    font: "inherit",
    boxSizing: "border-box",
  },
  selectInput: {
    width: "100%",
    borderRadius: 6,
    border: `1px solid ${PANEL_BORDER}`,
    background: PANEL_BG,
    color: PANEL_FG,
    padding: "8px 10px",
    font: "inherit",
    boxSizing: "border-box",
  },
  footer: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  submitButton: {
    alignSelf: "flex-start",
    appearance: "none",
    border: `1px solid ${PANEL_ACCENT}`,
    borderRadius: 6,
    background: PANEL_ACCENT,
    color: PANEL_ACCENT_FG,
    padding: "7px 12px",
    font: "inherit",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  },
  submitButtonDisabled: {
    opacity: 0.6,
    cursor: "default",
  },
  status: {
    fontSize: 11,
    color: PANEL_MUTED,
    lineHeight: 1.4,
  },
  error: {
    fontSize: 11,
    color: "#dc2626",
    lineHeight: 1.4,
  },
  warning: {
    fontSize: 11,
    color: "#92400e",
    lineHeight: 1.4,
  },
} satisfies Record<string, CSSProperties>;

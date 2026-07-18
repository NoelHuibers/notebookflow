/**
 * Sanitization for rich cell-output HTML (display_data / execute_result
 * "text/html", e.g. pandas DataFrame `_repr_html_`).
 *
 * The DOMPurify allowlist is deliberately tight: enough for tables and basic
 * inline markup to render, nothing that can script, style, or navigate. Kept
 * as a pure helper (separate from the CellOutputs component) so the allowlist
 * is independently testable.
 */

import DOMPurify from "dompurify";

export const OUTPUT_HTML_ALLOWED_TAGS: string[] = [
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "caption",
  "colgroup",
  "col",
  "div",
  "span",
  "br",
  "p",
  "strong",
  "em",
  "code",
];

export const OUTPUT_HTML_ALLOWED_ATTR: string[] = ["class", "colspan", "rowspan", "scope", "title"];

export function sanitizeOutputHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: OUTPUT_HTML_ALLOWED_TAGS,
    ALLOWED_ATTR: OUTPUT_HTML_ALLOWED_ATTR,
  });
}

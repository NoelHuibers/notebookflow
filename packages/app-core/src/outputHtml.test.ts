// @vitest-environment jsdom
// DOMPurify needs a real DOM to parse and rebuild markup — the package-level
// vitest environment stays "node" (see vitest.config.ts); this file opts into
// jsdom via the pragma above.

import { describe, expect, it } from "vitest";

import { sanitizeOutputHtml } from "./outputHtml";

describe("sanitizeOutputHtml", () => {
  it("keeps table markup and allowlisted attributes (pandas repr_html shape)", () => {
    const html =
      '<div class="dataframe"><table class="dataframe"><thead><tr><th scope="col" colspan="2">a</th></tr></thead>' +
      "<tbody><tr><td>1</td><td>2</td></tr></tbody></table></div>";
    const out = sanitizeOutputHtml(html);
    expect(out).toContain('<table class="dataframe">');
    expect(out).toContain('<th scope="col" colspan="2">a</th>');
    expect(out).toContain("<td>1</td>");
  });

  it("strips script tags entirely", () => {
    const out = sanitizeOutputHtml('<div>ok</div><script>alert("xss")</script>');
    expect(out).toBe("<div>ok</div>");
  });

  it("strips event-handler and style attributes", () => {
    const out = sanitizeOutputHtml('<span onclick="steal()" style="color:red" title="t">x</span>');
    expect(out).toBe('<span title="t">x</span>');
  });

  it("drops tags outside the allowlist but keeps their text content", () => {
    const out = sanitizeOutputHtml('<a href="https://evil.example">link</a><img src="x">');
    expect(out).not.toContain("<a");
    expect(out).not.toContain("<img");
    expect(out).toContain("link");
  });

  it("removes disallowed attributes like id", () => {
    const out = sanitizeOutputHtml('<p id="x" class="y">t</p>');
    expect(out).toBe('<p class="y">t</p>');
  });
});

import type { Components } from "react-markdown";
import type { Element, Root, RootContent } from "hast";
import "./MarkdownTable.css";

function textContent(child: Element | Root | RootContent): string {
  if (child.type === "text") return child.value;
  if (!("children" in child)) return "";
  return child.children.map((item) => textContent(item)).join("");
}

function tableHeading(node: Element | undefined): string {
  return node ? textContent(node).trim() : "";
}

/**
 * A headerless source table converts to blank header cells (markdown needs a
 * delimiter row), so its <thead> holds nothing and is hidden instead of
 * rendering an empty dimmed strip.
 */
function hasEmptyHeader(node: Element | undefined): boolean {
  const head = node?.children.find(
    (child): child is Element => child.type === "element" && child.tagName === "thead",
  );
  if (!head) return false;
  const cells = head.children.flatMap(
    (row) => (row.type === "element" ? row.children.filter((c): c is Element => c.type === "element") : []),
  );
  return cells.length > 0 && cells.every((cell) => textContent(cell).trim() === "");
}

/**
 * GFM table rendering. The visual rule — row lines only, no rule after the
 * last row, edge-to-edge via the wrap's negative margin against the cells'
 * own inset — is in MarkdownTable.css. The VEX arguments table in globals.css
 * uses the same inset, --md, so the two can't drift apart.
 */
export const Table: Components["table"] = ({ children, node }) => (
  <div className="not-prose markdown-table-wrap">
    <table
      className={`markdown-table ${/^TypeDeclaration(?:Description)?/.test(tableHeading(node)) ? "markdown-table-declarations" : ""} ${hasEmptyHeader(node) ? "markdown-table-headerless" : ""}`}
    >
      {children}
    </table>
  </div>
);

export const Th: Components["th"] = ({ children }) => <th>{children}</th>;

export const Td: Components["td"] = ({ children }) => <td>{children}</td>;

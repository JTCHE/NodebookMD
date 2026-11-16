/**
 * The names a reader tracks, coloured as an editor colours them. The
 * language files name keywords, strings, numbers and comments only, and only
 * at the top of a block. This pass runs after them, on the text they left
 * plain, at any depth: inside a call's parentheses as well as at the start
 * of a line. A word the language owns is already in a keyword span, so the
 * pass never colours one.
 */

/** A VEX binding (`@P`), a member after a dot, a call, or a name. */
const TOKEN = /@[A-Za-z_]\w*|(?<=\.)[A-Za-z_]\w*|\b[A-Za-z_]\w*\b/g;

/** The global attributes and variables of a VEX context. Bare, they are
    the same bindings as their `@` form, so they take the same colour. */
const VEX_GLOBALS = new Set([
  "P", "N", "v", "Cd", "Alpha", "uv", "pscale", "id", "age", "life", "force", "accel", "orient", "up", "scale",
  "ptnum", "primnum", "vtxnum", "numpt", "numprim", "numvtx", "Frame", "Time", "TimeInc", "OpInput1",
]);

function classOf(text: string, word: string, end: number, vex: boolean): string | null {
  if (word.startsWith("@")) return "hljs-binding";
  if (vex && VEX_GLOBALS.has(word) && text[end - word.length - 1] !== ".") return "hljs-binding";
  const call = /^\s*\(/.test(text.slice(end));
  if (call) return /^[A-Z]/.test(word) ? "hljs-title class_" : "hljs-title function_";
  if (text[end - word.length - 1] === ".") return "hljs-property";
  return /^[a-z_]/.test(word) ? "hljs-variable" : null;
}

/** Wraps each plain name under `code` in the span its role takes. */
export function colourNames(code: HTMLElement, owned: Set<string>, vex: boolean) {
  const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT, {
    // Only text no rule took: strings and comments keep their own colour.
    acceptNode: (node) =>
      node.parentElement === code || node.parentElement?.classList.contains("hljs-params")
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT,
  });
  const plain: Text[] = [];
  while (walker.nextNode()) plain.push(walker.currentNode as Text);
  for (const node of plain) {
    const text = node.data;
    const parts = document.createDocumentFragment();
    let from = 0;
    for (const match of text.matchAll(TOKEN)) {
      const word = match[0];
      const end = match.index + word.length;
      const role = owned.has(word) ? null : classOf(text, word, end, vex);
      if (!role) continue;
      parts.append(text.slice(from, match.index));
      const span = document.createElement("span");
      span.className = role;
      span.textContent = word;
      parts.append(span);
      from = end;
    }
    if (from === 0) continue;
    parts.append(text.slice(from));
    node.replaceWith(parts);
  }
}

/** The signature a hom page writes above its method, read from the raw
    markdown. A method line looks like:

    `<span id="name"></span>**\`name()\` → string**\`

    and the anchor in a link such as hou.ParmTemplate#name is that id, so the
    line the anchor names carries the signature — and with it the type the
    method returns, which is the type the caller passes. */
export function methodSignature(markdown: string, anchor: string): string | null {
  const line = markdown.split("\n").find((row) => row.startsWith(`<span id="${anchor}"></span>`));
  if (!line) return null;
  const strong = line.match(/\*\*(.+?)\*\*/);
  if (!strong) return null;
  const signature = strong[1]
    .replaceAll("`", "")
    // The call the help writes takes self first; the reader never passes it.
    .replace(/\(\s*(?:self|cls)\s*(?:,\s*)?/, "(")
    .trim();
  // A bare name with no call and no return type says nothing about types.
  if (!/[()→]|->/.test(signature)) return null;
  return signature;
}

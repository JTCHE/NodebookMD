import type { Root, RootContent } from "hast";

export interface Heading {
  id: string;
  text: string;
  level: number;
}

function text(node: RootContent): string {
  if (node.type === "text") return node.value;
  return "children" in node ? node.children.map(text).join("") : "";
}

/** Every h2–h6 of the parsed page, with the ids rehype-slug gave them. The
    h1 is the page title, drawn in the header. */
export function extractHeadings(tree: Root): Heading[] {
  const headings: Heading[] = [];
  const walk = (nodes: RootContent[]) => {
    for (const node of nodes) {
      if (node.type !== "element") continue;
      const level = /^h([2-6])$/.exec(node.tagName)?.[1];
      const id = node.properties.id;
      if (level && typeof id === "string") headings.push({ id, text: text(node).replace(/\s+/g, " ").trim(), level: Number(level) });
      else walk(node.children);
    }
  };
  walk(tree.children);
  return headings;
}

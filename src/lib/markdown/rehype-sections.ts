import type { Element, ElementContent, Root, RootContent } from "hast";

const LEVEL: Partial<Record<string, number>> = { h2: 2, h3: 3, h4: 4 };

interface Group {
  level: number;
  id: string;
  children: ElementContent[];
}

/** The content each h2–h4 heading owns goes into one div the heading can
    collapse: everything after it until a heading of its own level or higher.
    A lower-level heading's group nests inside, so closing an h2 closes its
    h3 sections with it. An empty group is dropped — a heading with no
    content of its own gets no toggle. Runs after rehypeSlug, which gives the
    headings their ids. See lib/ui/sections.ts for the toggle. */
export function rehypeSections() {
  return (tree: Root) => {
    const walk = (parent: Root | Element) => {
      const out: RootContent[] = [];
      const open: Group[] = [];
      const close = (keep: number) => {
        while (open.length > keep) {
          const group = open.pop()!;
          // Whitespace alone is no content: a heading that owns nothing gets
          // no group, and so no toggle.
          const content = group.children.filter((node) => node.type !== "text" || node.value.trim() !== "");
          if (content.length === 0) continue;
          const box: Element = {
            type: "element",
            tagName: "div",
            properties: { className: ["section-group"], dataSection: group.id },
            children: content,
          };
          (open.length > 0 ? open[open.length - 1].children : out).push(box);
        }
      };
      const place = (node: RootContent) => {
        (open.length > 0 ? open[open.length - 1].children : out).push(node as ElementContent);
      };
      for (const child of parent.children) {
        const level = child.type === "element" && child.tagName in LEVEL ? LEVEL[child.tagName] : undefined;
        if (child.type === "element" && level !== undefined) {
          close(open.filter((group) => group.level < level).length);
          place(child);
          const id = child.properties.id;
          open.push({ level, id: typeof id === "string" ? id : "", children: [] });
          continue;
        }
        if (child.type === "element") walk(child);
        place(child);
      }
      close(0);
      parent.children = out as typeof parent.children;
    };
    walk(tree);
  };
}

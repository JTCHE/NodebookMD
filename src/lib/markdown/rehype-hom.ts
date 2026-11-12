import type { Element, ElementContent, Root, RootContent } from "hast";
import { DISCLOSURE_INTERACTION } from "../ui/interactive";

const text = (node: ElementContent): string => node.type === "text" ? node.value : "children" in node ? node.children.map(text).join("") : "";
const div = (className: string, children: ElementContent[]): Element => ({ type: "element", tagName: "div", properties: { className: className.split(" ") }, children });

/** The chevron the headings use (lucide ChevronRight): closed points right,
    open rotates down. */
const chevronIcon = (className: string): Element => ({
  type: "element",
  tagName: "svg",
  properties: { className: [className], viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", ariaHidden: "true" },
  children: [{ type: "element", tagName: "path", properties: { d: "m9 18 6-6-6-6" }, children: [] }],
});

function formatted(source: string): string {
  if (source.length <= 88) return source;
  const open = source.indexOf("(");
  if (open < 0) return source;
  const args: string[] = [];
  let depth = 1, quote = "", escaped = false, from = open + 1;
  for (let position = from; position < source.length; position++) {
    const character = source[position];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") { quote = character; continue; }
    if ("([{".includes(character)) depth++;
    if (")]}".includes(character)) depth--;
    if ((character === "," && depth === 1) || depth === 0) {
      const arg = source.slice(from, position).trim();
      if (arg) args.push(arg);
      from = position + 1;
      if (depth === 0) return `${source.slice(0, open + 1)}\n    ${args.join(",\n    ")}\n)${source.slice(position + 1)}`;
    }
  }
  return source;
}

function highlight(code: Element) {
  const source = formatted(text(code));
  code.properties = { ...code.properties, className: ["language-python"], dataHighlighted: "yes" };
  code.children = [...source.matchAll(/(?:[rubf]{0,2})?(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|\b\d+(?:\.\d*)?\b|\b[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*|[^\w\s]|\s+/g)].map((match): ElementContent => {
    const token = match[0];
    const after = source.slice(match.index! + token.length);
    const kind = /^(?:[rubf]{0,2})?["']/.test(token) ? "hljs-string"
      : /^(?:None|True|False)$/.test(token) || /^\d/.test(token) ? "hljs-literal"
      : token.startsWith("hou.") ? "vex-tk-type"
      : /^\s*\(/.test(after) && /^\w/.test(token) ? "vex-tk-fn"
      : token === "self" || token === "cls" ? "hljs-built_in"
      : /^\w/.test(token) ? "vex-tk-arg"
      : /^\s+$/.test(token) ? "" : "vex-tk-punct";
    return kind ? { type: "element", tagName: "span", properties: { className: [kind] }, children: [{ type: "text", value: token }] } : { type: "text", value: token };
  });
}

/** Keep method anchors and return links while moving signatures into the shared panel. */
export function rehypeHom({ enabled }: { enabled: boolean }) {
  return (tree: Root) => {
    if (!enabled) return;
    const summaries = new WeakMap<Element, ElementContent[]>();
    /** Signature arguments the page documents elsewhere link there: the
        description's `See hou.ParmTemplate.name` becomes the hover target of
        the `name` token in the signature itself. */
    const documentedArgs = (body: ElementContent[]) => {
      const found = new Map<string, string>();
      const visit = (node: ElementContent) => {
        if (node.type !== "element") return;
        if (node.tagName === "a") {
          const label = text(node).trim();
          const parameter = label.includes(".") ? label.split(".").pop()! : "";
          const href = node.properties.href;
          if (parameter && typeof href === "string") found.set(parameter, href);
        }
        for (const child of node.children ?? []) visit(child);
      };
      for (const node of body) visit(node);
      return found;
    };
    const visit = (parent: Root | Element) => {
      const out: RootContent[] = [];
      for (const child of parent.children) {
        if (child.type !== "element") { out.push(child); continue; }
        if (child.tagName === "p") {
          const at = child.children.findIndex((node) => node.type === "element" && node.tagName === "strong");
          const strong = child.children[at];
          const first = strong?.type === "element" ? strong.children[0] : undefined;
          const leading = child.children.slice(0, at);
          if (first?.type === "element" && first.tagName === "code" && /^[\w.]+\s*\(/.test(text(first)) && leading.every((node) => !text(node).trim())) {
            const raw = text(first).replace(/\(\s*(?:self|cls)\s*(?:,\s*)?/, "(");
            const compact = raw.length > 88 ? `${raw.slice(0, raw.indexOf("("))}(…)` : raw;
            const returns: ElementContent[] = JSON.parse(JSON.stringify((strong as Element).children.slice(1)));
            for (const node of (strong as Element).children) if (node.type === "element" && node.tagName === "code") highlight(node);
            const panel = div("vex-sig hom-signature", [div("vex-sig-card code-panel", [div("vex-sig-row", (strong as Element).children)])]);
            summaries.set(panel, [...leading, { type: "element", tagName: "span", properties: { className: ["hom-method-name"] }, children: [{ type: "text", value: compact }] }, ...returns]);
            out.push(panel);
            const rest = child.children.slice(at + 1);
            while (rest.length && ((rest[0].type === "element" && rest[0].tagName === "br") || (rest[0].type === "text" && !rest[0].value.trim()))) rest.shift();
            if (rest.length) out.push({ ...child, children: rest });
            continue;
          }
        }
        visit(child);
        out.push(child);
      }
      const grouped: RootContent[] = [];
      for (let position = 0; position < out.length; position++) {
        const panel = out[position];
        const title = panel.type === "element" ? summaries.get(panel) : undefined;
        if (!title) { grouped.push(panel); continue; }
        const body: ElementContent[] = [panel as Element];
        while (position + 1 < out.length) {
          const next = out[position + 1];
          if (next.type === "element" && (summaries.has(next) || /^h[1-6]$/.test(next.tagName))) break;
          body.push(next as ElementContent);
          position++;
        }
        // The signature's own arguments link to where the page documents them.
        const documented = documentedArgs(body.slice(1));
        if (documented.size > 0) {
          const card = (panel as Element).children[0];
          const row = card?.type === "element"
            ? card.children.find((child: ElementContent): child is Element => child.type === "element" && (child.properties.className as string[] | undefined)?.includes("vex-sig-row") === true)
            : undefined;
          if (row?.type === "element") {
            row.children = row.children.map((token: ElementContent) => {
              if (token.type !== "element") return token;
              const classes = token.properties.className as string[] | undefined;
              const href = classes?.includes("vex-tk-arg") ? documented.get(text(token)) : undefined;
              return href ? { type: "element", tagName: "a", properties: { href }, children: [token] } : token;
            });
          }
        }
        const caption = body[1];
        const summary: ElementContent[] = [{ type: "element", tagName: "span", properties: { className: ["hom-method-chevron", "transition-opacity", "duration-(--duration-fast)", "motion-reduce:transition-none"], ariaHidden: "true" }, children: [chevronIcon("")] }, div("hom-method-title", title)];
        if (caption?.type === "element" && caption.tagName === "p") {
          caption.properties.className = ["hom-method-caption"];
          summary.push(caption);
          body.splice(1, 1);
        }
        grouped.push({ type: "element", tagName: "details", properties: { className: ["hom-method"] }, children: [
          { type: "element", tagName: "summary", properties: { className: DISCLOSURE_INTERACTION.split(" ") }, children: summary },
          div("hom-method-body", [body[0], div("hom-method-description", body.slice(1))]),
        ] });
      }
      const lists: RootContent[] = [];
      let methods: ElementContent[] = [];
      const flush = () => {
        if (methods.length) lists.push(div("hom-method-list", methods));
        methods = [];
      };
      for (const node of grouped) {
        if (node.type === "element" && node.tagName === "details" && (node.properties.className as string[] | undefined)?.includes("hom-method")) methods.push(node);
        else { flush(); lists.push(node); }
      }
      flush();
      parent.children = lists as ElementContent[];
    };
    visit(tree);
  };
}

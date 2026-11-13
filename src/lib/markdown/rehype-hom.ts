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

/** The names a signature takes: `f(self, name, label=None, *args)` gives
    name, label and args. */
const parameters = (signature: string): Set<string> => {
  const inside = signature.slice(signature.indexOf("(") + 1, signature.lastIndexOf(")"));
  // The commas between arguments, not the ones in a type: `Union[int, str]`.
  const parts: string[] = [];
  let depth = 0;
  let part = "";
  for (const character of inside) {
    if ("([{".includes(character)) depth += 1;
    if (")]}".includes(character)) depth -= 1;
    if (character === "," && depth === 0) {
      parts.push(part);
      part = "";
    } else {
      part += character;
    }
  }
  parts.push(part);
  // The name is the last word before a type or a default: `data: dict`,
  // `order=4`, and the C form `bool exact_type_name=False`.
  return new Set(parts.map((entry) => entry.split(/[:=]/)[0].replace(/\*/g, "").trim().split(/\s+/).pop() ?? "").filter((name) => /^[A-Za-z_]\w*$/.test(name)));
};

/** A paragraph that documents one of the method's arguments, in either form
    SideFX writes: `**`name`**` then a line break, or `name: text`. Gives the
    name and the description, or nothing. `known` accepts the bold form for
    a name the signature leaves out: some pages document an argument their
    signature does not show (`look` on StringParmTemplate). */
const parameterOf = (node: ElementContent, names: Set<string>, known = (name: string) => names.has(name)): { name: string; anchors: ElementContent[]; description: ElementContent[] } | null => {
  if (node.type !== "element" || node.tagName !== "p") return null;
  // An anchor in front of the name, `<span id>`, goes with the name.
  let skip = 0;
  while (node.children[skip]?.type === "element" && (node.children[skip] as Element).tagName === "span" && (node.children[skip] as Element).properties.id && !text(node.children[skip] as Element)) skip++;
  const anchors = node.children.slice(0, skip);
  const [first, second] = node.children.slice(skip);
  if (first?.type === "element" && first.tagName === "strong" && second?.type === "element" && second.tagName === "br" && known(text(first).trim())) {
    const description = node.children.slice(skip + 2);
    if (description[0]?.type === "text") description[0] = { ...description[0], value: description[0].value.replace(/^\s+/, "") };
    return { name: text(first).trim(), anchors, description };
  }
  if (first?.type !== "text") return null;
  const match = /^([A-Za-z_]\w*):\s/.exec(first.value);
  if (!match || !names.has(match[1])) return null;
  return { name: match[1], anchors, description: [{ type: "text", value: first.value.slice(match[0].length) }, ...node.children.slice(skip + 1)] };
};

/** The argument paragraphs become one list: the name, then what it does.
    One list reads down a column of names, not a stack of chips. A block
    between two arguments is more about the one above it, so it goes in that
    one's description; a block after the last argument stays outside. */
const listParameters = (nodes: ElementContent[], names: Set<string>): ElementContent[] => {
  const parameters = nodes.map((node) => parameterOf(node, names));
  // Next to an argument, a bold name is an argument too, even when the
  // signature calls it something else (`num_vertices` for `num_points`).
  const loose = (index: number) => parameterOf(nodes[index], names, (name) => /^[A-Za-z_]\w*$/.test(name));
  // Blank text between blocks is no neighbour.
  const blocks = nodes.flatMap((node, index) => (node.type === "text" && !node.value.trim() ? [] : [index]));
  for (let at = 1; at < blocks.length; at++) parameters[blocks[at]] ??= parameters[blocks[at - 1]] ? loose(blocks[at]) : null;
  for (let at = blocks.length - 2; at >= 0; at--) parameters[blocks[at]] ??= parameters[blocks[at + 1]] ? loose(blocks[at]) : null;
  const last = parameters.findLastIndex(Boolean);
  const out: ElementContent[] = [];
  let list: Element | null = null;
  let description: Element | null = null;
  nodes.forEach((node, index) => {
    const parameter = parameters[index];
    if (parameter) {
      if (!list) {
        list = { type: "element", tagName: "dl", properties: { className: ["hom-params"] }, children: [] };
        out.push(list);
      }
      description = { type: "element", tagName: "dd", properties: {}, children: [{ type: "element", tagName: "p", properties: {}, children: parameter.description }] };
      list.children.push({ type: "element", tagName: "dt", properties: {}, children: [...parameter.anchors, { type: "text", value: parameter.name }] }, description);
    } else if (description && index < last) {
      description.children.push(node);
    } else {
      out.push(node);
    }
  });
  return out;
};

/** An enum's value, `**Python**` under Values, reads as the name a script
    writes: `hou.exprLanguage.Python`. */
const markValues = (group: Element, name: string) => {
  for (const node of group.children) {
    if (node.type !== "element" || node.tagName !== "p") continue;
    const strong = node.children[0];
    if (strong?.type !== "element" || strong.tagName !== "strong") continue;
    const value = text(strong);
    if (!/^[A-Za-z_]\w*$/.test(value)) continue;
    node.children[0] = { type: "element", tagName: "code", properties: {}, children: [
      { type: "element", tagName: "span", properties: { className: ["hom-value-prefix"] }, children: [{ type: "text", value: `${name}.` }] },
      { type: "text", value },
    ] };
  }
};

/** Keep method anchors and return links while moving signatures into the shared panel.
    `name` is the page's dotted name, `hou.Parm`; null turns the plugin off. */
export function rehypeHom({ name }: { name: string | null }) {
  return (tree: Root) => {
    if (!name) return;
    const summaries = new WeakMap<Element, ElementContent[]>();
    // Each panel's method name, for the filter, and the panels whose row
    // cuts the signature to `name(…)`, which keep the full one to open.
    const methodNames = new WeakMap<Element, string>();
    const shortened = new WeakSet<Element>();
    /** Signature arguments the page documents elsewhere link there: the
        description's `See hou.ParmTemplate.name` becomes the hover target of
        the `name` token in the signature itself. `num_components` matches the
        link's `numComponents`, so both sides fold case and underscores. */
    const fold = (value: string) => value.toLowerCase().replace(/[_\s]/g, "");
    const documentedArgs = (body: ElementContent[]) => {
      const found = new Map<string, string>();
      const visit = (node: ElementContent) => {
        if (node.type !== "element") return;
        if (node.tagName === "a") {
          const label = text(node).trim();
          const parameter = label.includes(".") ? label.split(".").pop()! : label;
          const href = node.properties.href;
          if (parameter && typeof href === "string") found.set(fold(parameter), href);
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
            // The return type reads as plain text in the summary: the prose's
            // inline-code chip would shout inside a row that is already
            // monospace. Links keep working; only the chip comes off.
            const plain = (node: ElementContent): ElementContent => {
              if (node.type !== "element") return node;
              const children = node.children.map((child) => plain(child));
              return node.tagName === "code"
                ? { type: "element", tagName: "span", properties: {}, children }
                : { ...node, children };
            };
            const returns: ElementContent[] = (JSON.parse(JSON.stringify((strong as Element).children.slice(1))) as ElementContent[]).map(plain);
            for (const node of (strong as Element).children) if (node.type === "element" && node.tagName === "code") highlight(node);
            const panel = div("vex-sig hom-signature", [div("vex-sig-card code-panel", [div("vex-sig-row", (strong as Element).children)])]);
            methodNames.set(panel, raw.slice(0, raw.indexOf("(")).trim());
            if (compact !== raw) shortened.add(panel);
            summaries.set(panel, [...leading, { type: "element", tagName: "span", properties: { className: ["hom-method-name"] }, children: [{ type: "text", value: compact }] }, ...returns]);
            out.push(panel);
            const rest = child.children.slice(at + 1);
            while (rest.length && ((rest[0].type === "element" && rest[0].tagName === "br") || (rest[0].type === "text" && !rest[0].value.trim()))) rest.shift();
            if (rest.length) out.push({ ...child, children: rest });
            continue;
          }
        }
        if (child.properties.dataSection === "values") markValues(child, name);
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
        // The signature's own arguments link to where the page documents
        // them. The tokens sit in the row's code element.
        const documented = documentedArgs(body.slice(1));
        if (documented.size > 0) {
          const card = (panel as Element).children[0];
          const row = card?.type === "element"
            ? card.children.find((child: ElementContent): child is Element => child.type === "element" && (child.properties.className as string[] | undefined)?.includes("vex-sig-row") === true)
            : undefined;
          const wrap = (element: Element) => {
            element.children = element.children.map((token: ElementContent) => {
              if (token.type !== "element") return token;
              const classes = token.properties.className as string[] | undefined;
              const href = classes?.includes("vex-tk-arg") === true ? documented.get(fold(text(token))) : undefined;
              // The class tells the renderer this link carries no page mark:
              // a page icon in front of every argument is noise.
              return href ? { type: "element", tagName: "a", properties: { href, className: ["vex-sig-arg"] }, children: [token] } : token;
            });
          };
          if (row?.type === "element") {
            for (const child of row.children) {
              if (child.type === "element" && (child.properties.className as string[] | undefined)?.includes("language-python") === true) wrap(child);
            }
          }
        }
        const signature = text(((panel as Element).children[0] as Element));
        const names = parameters(signature);
        const caption = body[1];
        const summary: ElementContent[] = [{ type: "element", tagName: "span", properties: { className: ["hom-method-chevron", "transition-opacity", "duration-(--duration-fast)", "motion-reduce:transition-none"], ariaHidden: "true" }, children: [chevronIcon("")] }, div("hom-method-title", title)];
        if (caption?.type === "element" && caption.tagName === "p") {
          caption.properties.className = ["hom-method-caption"];
          summary.push(caption);
          body.splice(1, 1);
        }
        const methodName = methodNames.get(panel as Element) ?? "";
        // A row opens only when it holds more than it shows: a description,
        // or the full signature it cut. A row with nothing more is a plain
        // row, with no chevron and no hover, so the two never look alike.
        if (body.length === 1 && !shortened.has(panel as Element)) {
          grouped.push({ type: "element", tagName: "div", properties: { className: ["hom-method", "hom-method-static"], dataName: methodName }, children: [div("hom-method-row", summary.slice(1))] });
          continue;
        }
        // The row already shows the whole signature unless it cut it, so the
        // code panel comes in only to show what the row left out.
        const panelShown = shortened.has(panel as Element) ? [body[0]] : [];
        grouped.push({ type: "element", tagName: "details", properties: { className: ["hom-method"], dataName: methodName }, children: [
          { type: "element", tagName: "summary", properties: { className: DISCLOSURE_INTERACTION.split(" ") }, children: summary },
          div("hom-method-body", [...panelShown, div("hom-method-description", listParameters(body.slice(1), names))]),
        ] });
      }
      const lists: RootContent[] = [];
      let methods: ElementContent[] = [];
      const flush = () => {
        if (methods.length) lists.push(div("hom-method-list", methods));
        methods = [];
      };
      for (const node of grouped) {
        if (node.type === "element" && (node.properties.className as string[] | undefined)?.includes("hom-method")) methods.push(node);
        else { flush(); lists.push(node); }
      }
      flush();
      parent.children = lists as ElementContent[];
    };
    visit(tree);
    // The class's own Methods and the inherited ones go in one box: the
    // find bar's method filter covers all of them (lib/ui/method-filter).
    const start = tree.children.findIndex((node) => node.type === "element" && node.tagName === "h2" && node.properties.id === "methods");
    if (start >= 0) {
      const isMethods = (node: RootContent) =>
        node.type === "text" ? !node.value.trim()
        : node.type === "element" && /^methods(-from-|$)/.test(String(node.properties.id ?? node.properties.dataSection ?? ""));
      let end = start;
      while (end < tree.children.length && isMethods(tree.children[end])) end++;
      const box = div("hom-methods", tree.children.slice(start, end) as ElementContent[]);
      tree.children.splice(start, end - start, box);
    }
  };
}

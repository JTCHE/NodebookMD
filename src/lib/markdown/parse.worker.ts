/// <reference lib="webworker" />
/**
 * Turns a page's markdown into the tree the reading view draws, away from the
 * main thread. A long index page is 200 KB of markdown and 250 ms of parse:
 * done on the main thread, it froze the window between the press and the page.
 *
 * The pipeline is react-markdown's, with the page plugins. The positions come
 * off before the tree is sent: nothing reads them, and they doubled the copy.
 */
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeSlug from "rehype-slug";
import { defaultUrlTransform } from "react-markdown";
import { urlAttributes } from "html-url-attributes";
import type { Nodes } from "hast";
import { remarkCallouts } from "./remark-callouts";
import { remarkVex } from "./remark-vex";
import { rehypeCards } from "./rehype-cards";
import { rehypeSections } from "./rehype-sections";
import { rehypeHom } from "./rehype-hom";

function processor(vex: boolean, hom: boolean) {
  return unified()
    .use(remarkParse)
    .use([remarkGfm, remarkCallouts, [remarkVex, { enabled: vex }]] as never)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use([rehypeRaw, rehypeSlug, rehypeSections, rehypeCards, [rehypeHom, { enabled: hom }]] as never);
}

/** What react-markdown does to the tree before it draws it: raw HTML the
    parser left is text, and an address in a scheme it does not trust is cut. */
function clean(node: Nodes) {
  delete node.position;
  if (node.type === "element") {
    for (const key in urlAttributes) {
      const test = urlAttributes[key];
      if (Object.hasOwn(node.properties, key) && (test === null || test.includes(node.tagName))) {
        node.properties[key] = defaultUrlTransform(String(node.properties[key] || ""));
      }
    }
  }
  if ("children" in node) {
    const children = node.children.map((child) => (child.type === "raw" ? { type: "text", value: child.value } : child)) as Nodes[];
    node.children = children as never;
    for (const child of children) clean(child);
  }
}

self.onmessage = ({ data }: MessageEvent<{ id: number; vex: boolean; hom: boolean; markdown: string }>) => {
  try {
    const run = processor(data.vex, data.hom);
    const tree = run.runSync(run.parse(data.markdown));
    clean(tree);
    self.postMessage({ id: data.id, tree });
  } catch (reason) {
    self.postMessage({ id: data.id, error: String(reason) });
  }
};

import type { Root } from "hast";
import Parser from "./parse.worker?worker";

let worker: Worker | null = null;
let next = 0;
const asked = new Map<number, { done: (tree: Root) => void; fail: (reason: Error) => void }>();

/** A page's markdown as the tree the reading view draws, parsed in a worker.
    The worker starts with the first page and stays for the session. */
export function parse(path: string, markdown: string): Promise<Root> {
  if (!worker) {
    worker = new Parser();
    worker.onmessage = ({ data }: MessageEvent<{ id: number; tree?: Root; error?: string }>) => {
      const call = asked.get(data.id);
      asked.delete(data.id);
      if (data.tree) call?.done(data.tree);
      else call?.fail(new Error(data.error));
    };
  }
  const id = next++;
  return new Promise((done, fail) => {
    asked.set(id, { done, fail });
    // A hou page passes its dotted name, `hou.exprLanguage`; other pages pass null.
    const hom = /^\/?hom\/hou\//.test(path) ? path.replace(/^\/?hom\//, "").replaceAll("/", ".") : null;
    worker!.postMessage({ id, vex: /(^|\/)vex\//.test(`/${path}`), hom, markdown });
  });
}

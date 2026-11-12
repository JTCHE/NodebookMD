import { useLayoutEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { PageView } from "@/lib/pages";
import { MENU_ITEM } from "@/lib/ui/menu";
import { cn } from "@/lib/utils";
import DocLink from "./DocLink";

export function Inheritance({ items }: { items: PageView["inheritance"] }) {
  const section = useRef<HTMLElement>(null);
  const currentNode = useRef<HTMLSpanElement>(null);
  const [wires, setWires] = useState("");
  const current = items.find((item) => item.current);
  const ancestors = current ? items.filter((item) => item.depth < current.depth) : [];
  const children = current ? items.filter((item) => item.depth > current.depth) : [];
  const link = cn(MENU_ITEM, "relative w-fit max-w-full px-2 py-1 text-xs break-all");

  useLayoutEffect(() => {
    const box = section.current;
    const own = currentNode.current;
    if (!box || !own) return;
    const draw = () => {
      const bounds = box.getBoundingClientRect();
      const nodes = [...box.querySelectorAll<HTMLElement>("[data-subclass]")].map((node) => node.getBoundingClientRect());
      if (!nodes.length) { setWires(""); return; }
      const origin = own.getBoundingClientRect();
      const start = origin.left + origin.width / 2 - bounds.left;
      const bus = Math.min(...nodes.map((node) => node.top)) - bounds.top - 10;
      const columns = new Map<number, DOMRect[]>();
      for (const node of nodes) {
        const x = node.left - bounds.left - 6;
        columns.set(x, [...(columns.get(x) ?? []), node]);
      }
      const xs = [...columns.keys(), start];
      const left = Math.min(...xs);
      const right = Math.max(...xs);
      const paths = start > left
        ? [`M${start},${origin.bottom - bounds.top} V${bus - 4} Q${start},${bus} ${start - 4},${bus} H${left}`]
        : [`M${start},${origin.bottom - bounds.top} V${bus - 4} Q${start},${bus} ${start + 4},${bus} H${right}`];
      if (start > left && right > start) paths.push(`M${start},${bus} H${right}`);
      for (const [x, nodes] of columns) {
        const bottom = Math.max(...nodes.map((node) => node.top + node.height / 2 - bounds.top));
        paths.push(`M${x},${bus} V${bottom - 4} Q${x},${bottom} ${x + 4},${bottom} H${x + 6}`);
        for (const node of nodes.slice(0, -1)) {
          const y = node.top + node.height / 2 - bounds.top;
          paths.push(`M${x},${y} H${x + 6}`);
        }
      }
      setWires(paths.join(" "));
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(box);
    return () => observer.disconnect();
  }, [items]);

  if (!current) return null;
  return (
    <section ref={section} aria-label="Class inheritance" className="not-prose relative -mx-2 mb-6 px-2 py-2">
      <svg aria-hidden="true" className="pointer-events-none absolute inset-0 size-full overflow-visible text-neutral-300" fill="none">
        <path d={wires} stroke="currentColor" strokeWidth="1" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <ol aria-label="Inheritance, from base to current class" className="relative -ml-2 flex flex-wrap items-center gap-y-1">
        {ancestors.map((item) => (
          <li key={item.path} className="flex min-w-0 items-center">
            <DocLink href={item.path} mark={false} underline={false} className={link}>{item.name}</DocLink>
            <ChevronRight aria-hidden="true" className="size-3 shrink-0 text-neutral-400" />
          </li>
        ))}
        <li className="min-w-0"><span ref={currentNode} aria-current="page" className="relative inline-block rounded-md bg-neutral-100 px-2 py-1 text-xs font-medium text-neutral-950">{current.name}</span></li>
      </ol>
      {children.length > 0 && (
        <ul aria-label={`Direct subclasses of ${current.name}`} className="relative mt-6 grid grid-cols-2 gap-x-3 gap-y-1 pl-3 sm:grid-cols-3">
          {children.map((item) => (
            <li key={item.path} className="min-w-0">
              <div data-subclass className="w-fit max-w-full"><DocLink href={item.path} mark={false} underline={false} className={link}>{item.name}</DocLink></div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

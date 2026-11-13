// This was written with GPT 6.1 Sol (and it shows)
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import type { PageView } from "@/lib/pages";
import { MENU_ITEM } from "@/lib/ui/menu";
import { cn } from "@/lib/utils";
import DocLink from "./DocLink";

type Class = PageView["inheritance"][number];

export function Inheritance({ items, fromPath }: { items: PageView["inheritance"]; fromPath?: string | null }) {
  const section = useRef<HTMLElement>(null);
  const [wires, setWires] = useState("");
  const [columnCount, setColumnCount] = useState(2);
  const current = items.find((item) => item.current);
  useLayoutEffect(() => {
    const box = section.current;
    if (!box) return;
    const draw = () => {
      const bounds = box.getBoundingClientRect();
      setColumnCount(bounds.width >= 540 ? 3 : bounds.width >= 320 ? 2 : 1);
      const nodes = new Map([...box.querySelectorAll<HTMLElement>("[data-class]")].map((node) => [node.dataset.class!, node]));
      const paths: string[] = [];
      for (const group of box.querySelectorAll<HTMLElement>("[data-parent]")) {
        const parent = nodes.get(group.dataset.parent!);
        if (!parent) continue;
        const own = parent.getBoundingClientRect();
        const endpoints = [...group.querySelectorAll<HTMLElement>("[data-branch]")].filter((node) => node.closest("[data-parent]") === group);
        // A nested list hangs straight down from one point near the parent's
        // left edge, the same on every parent. Hung from the centre it fell
        // back to a fixed indent when the labels did not fit, and the wire
        // then ran down, back left and down again.
        const drop = group.dataset.nested ? own.left + Math.min(own.width / 2, 10) : own.left + own.width / 2;
        if (group.dataset.nested) {
          group.style.paddingLeft = `${drop - group.getBoundingClientRect().left + 8}px`;
        }
        const entries = endpoints.map((node) => node.getBoundingClientRect());
        if (!entries.length) continue;
        const bus = Math.min(...entries.map((node) => node.top)) - bounds.top - 10;
        // Members that all sit in one row take their wire from the top, into
        // the middle of each pill. A column of members hangs off one wire
        // down its left side instead.
        const row = !group.dataset.nested && new Set(entries.map((node) => node.left)).size === entries.length;
        const columns = new Map<number, DOMRect[]>();
        for (const node of entries) {
          const horizontalPosition = row ? node.left + node.width / 2 - bounds.left : node.left - bounds.left - 8;
          columns.set(horizontalPosition, [...(columns.get(horizontalPosition) ?? []), node]);
        }
        const start = drop - bounds.left;
        const joints = [...new Set([...columns.keys(), start])].sort((firstPosition, secondPosition) => firstPosition - secondPosition);
        const radius = (horizontalPosition: number) => Math.min(6, ...joints.filter((neighborPosition) => neighborPosition !== horizontalPosition).map((neighborPosition) => Math.abs(neighborPosition - horizontalPosition) / 2));
        const split = radius(start);
        paths.push(`M${start},${own.bottom - bounds.top} V${bus - split}`);
        for (let iteration = 0; iteration < joints.length; iteration++) {
          const horizontalPosition = joints[iteration], cornerRadius = radius(horizontalPosition);
          if (iteration > 0) paths.push(`M${joints[iteration - 1] + radius(joints[iteration - 1])},${bus} H${horizontalPosition - cornerRadius}`);
          if (horizontalPosition === start) {
            if (iteration > 0) paths.push(`M${horizontalPosition},${bus - cornerRadius} Q${horizontalPosition},${bus} ${horizontalPosition - cornerRadius},${bus}`);
            if (iteration < joints.length - 1) paths.push(`M${horizontalPosition},${bus - cornerRadius} Q${horizontalPosition},${bus} ${horizontalPosition + cornerRadius},${bus}`);
          }
          if (columns.has(horizontalPosition)) {
            if (iteration > 0) paths.push(`M${horizontalPosition - cornerRadius},${bus} Q${horizontalPosition},${bus} ${horizontalPosition},${bus + cornerRadius}`);
            if (iteration < joints.length - 1) paths.push(`M${horizontalPosition + cornerRadius},${bus} Q${horizontalPosition},${bus} ${horizontalPosition},${bus + cornerRadius}`);
            if (horizontalPosition === start) paths.push(`M${horizontalPosition},${bus - cornerRadius} V${bus + cornerRadius}`);
          }
        }
        for (const [horizontalPosition, nodes] of columns) {
          if (row) {
            paths.push(`M${horizontalPosition},${bus + radius(horizontalPosition)} V${nodes[0].top - bounds.top}`);
            continue;
          }
          const bottom = Math.max(...nodes.map((node) => node.top + node.height / 2 - bounds.top));
          paths.push(`M${horizontalPosition},${bus + radius(horizontalPosition)} V${bottom - 3} Q${horizontalPosition},${bottom} ${horizontalPosition + 3},${bottom} H${horizontalPosition + 8}`);
          for (const node of nodes.slice(0, -1)) {
            const verticalPosition = node.top + node.height / 2 - bounds.top;
            paths.push(`M${horizontalPosition},${verticalPosition} H${horizontalPosition + 8}`);
          }
        }
      }
      setWires(paths.join(" "));
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(box);
    box.querySelectorAll("[data-class]").forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [items, columnCount]);
  if (!current) return null;
  // The group's parent: the chain's last class, or a doc group's name for a
  // family-less page. The chain is every class above it.
  const anchor = items.find((item) => item.anchor);
  const chain = anchor
    ? items.filter((item) => item.depth < anchor.depth || item === anchor)
    : items.filter((item) => !item.current && item.depth < current.depth);
  // The classes in the group below the anchor. In a doc group, a member
  // that another member parents nests under that member instead.
  const siblings = !anchor ? [] : anchor.label
    ? items.filter((item) => !item.label && item.depth === current.depth && (item.parent === null || !items.some((mate) => !mate.label && mate.depth === current.depth && mate.name === item.parent)))
    : items.filter((item) => !item.label && item.depth === anchor.depth + 1);
  const grouped = !!anchor && siblings.length > 1;
  const familyless = grouped && !!anchor.label;
  const childrenOf = (parent: Class) => items.filter((item) => !item.label && item !== parent && item.parent === parent.name && (item.depth > parent.depth || (familyless && item.depth === parent.depth)));
  const link = cn(MENU_ITEM, "w-fit max-w-full px-1 py-1 text-xs font-medium");
  const node = (item: Class) => item.label
    ? <span data-node-label className="truncate px-1 py-1 text-xs font-medium text-neutral-500">{item.name}</span>
    : item.current
    ? <span aria-current="page" className="inline-flex max-w-full rounded-md bg-neutral-100 px-1 py-1 text-xs font-medium text-neutral-950"><span data-node-label className="truncate">{item.name.replace(/^hou\./, "")}</span></span>
    : <DocLink href={item.path} mark={false} underline={false} className={cn(link, "min-w-0", item.path.replace(/^\/+/, "") === fromPath && "bg-neutral-100/60")}><span data-node-label className="truncate">{item.name.replace(/^hou\./, "")}</span></DocLink>;
  const group = (list: Class[], parent: Class, label: string, nested = false): ReactNode => {
    if (!list.length) return null;
    const shown = list;
    const slots = nested ? 1 : Math.min(columnCount, shown.length);
    const size = Math.floor(shown.length / slots);
    const extra = shown.length % slots;
    const columns = Array.from({ length: slots }, (_, position) => {
      const start = position * size + Math.min(position, extra);
      return shown.slice(start, start + size + (position < extra ? 1 : 0));
    });
    return (
      <div className={cn("relative", nested ? "mt-4" : "mt-6")}>
        <div data-parent={parent.name} data-nested={nested || undefined} role="group" aria-label={label} className="grid gap-x-3 pl-3 pr-2" style={{ gridTemplateColumns: `repeat(${slots}, minmax(0, 1fr))` }}>
          {columns.map((column, position) => <ul key={position} className="flex min-w-0 flex-col gap-0.5">{column.map((item) => {
            const kids = childrenOf(item);
            // A member with more children than one row's columns hands them
            // to the full-width block below; anything shorter nests under
            // the member.
            const hoists = kids.length > columnCount;
            return <li key={item.path} className="min-w-0"><span data-class={item.name} data-branch className="inline-flex max-w-full align-top">{node(item)}</span>{grouped && !nested && !hoists && group(kids, item, `Subclasses of ${item.name}`, true)}</li>;
          })}</ul>)}
        </div>
        {/* A member's subclasses are the same list the subclass's own page
            shows as its sibling row, so once they would tower past one
            column's worth they take the same balanced columns across the full
            width instead of one column under their parent: OpNode's children
            read the same from Node as from SopNode. The wire still finds the
            parent pill by name. */}
        {grouped && !nested && shown.map((item) => {
          const kids = childrenOf(item);
          return kids.length > columnCount ? <div key={item.path}>{group(kids, item, `Subclasses of ${item.name}`)}</div> : null;
        })}
      </div>
    );
  };
  return (
    <section ref={section} aria-label="Class inheritance" className="not-prose relative -mx-1 mb-6 px-1 py-2">
      <svg aria-hidden="true" className="pointer-events-none absolute inset-0 size-full overflow-visible text-neutral-300" fill="none"><path d={wires} stroke="currentColor" strokeWidth="1" strokeLinejoin="round" strokeLinecap="round" /></svg>
      <ol data-chain aria-label={familyless ? "Related classes" : "Inheritance, from base to current class"} className={cn("-ml-1 flex min-w-0 items-center", familyless && "flex-wrap")}>
        {chain.map((item, iteration) => <li key={item.path || item.name} className="flex min-w-0 shrink items-center"><span data-class={item.name} className="min-w-0 max-w-full">{node(item)}</span>{(!grouped || iteration < chain.length - 1) && <ChevronRight aria-hidden="true" className="size-3 shrink-0 text-neutral-400" />}</li>)}
        {!anchor && <li className="shrink-0"><span data-class={current.name}>{node(current)}</span></li>}
      </ol>
      {grouped && !familyless && group(siblings, anchor, siblings.includes(current) ? `Subclasses of ${anchor.name}, including the current class` : `Family of ${anchor.name}`)}
      {familyless && group(siblings, anchor, `Classes in the ${anchor.name} group, including the current class`)}
      {!anchor && group(childrenOf(current), current, `Subclasses of ${current.name}`)}
    </section>
  );
}

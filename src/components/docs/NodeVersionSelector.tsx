import { Check, ChevronDown } from "lucide-react";
import { useNavigate } from "react-router";
import { cn } from "@/lib/utils";
import { MENU_ICON, MENU_ITEM, MENU_PANEL, useMenu } from "@/lib/ui/menu";
import type { NodeVersion } from "@/lib/pages";

/** `4.0` reads as "Version 4.0". "Latest" and "Earlier" read as they are. */
function named(label: string): string {
  return /^\d/.test(label) ? `Version ${label}` : label;
}

/**
 * Which version of the node this page describes, and the way to the others.
 *
 * The search and the title list hold only the newest version, so an older one
 * opens only from here or from a link that names it. A page that is not the
 * newest says so in the colour of the chip. See spec: Node Version Selector.
 */
export function NodeVersionSelector({ versions, path }: { versions: NodeVersion[]; path: string }) {
  const navigate = useNavigate();
  const { open, setOpen, container, menu, trigger, onKeyDown } = useMenu();
  const current = versions.find((version) => version.path === path);
  if (!current || versions.length < 2) return null;
  const latest = versions[0];
  const onLatest = current === latest;

  function pick(version: NodeVersion) {
    setOpen(false);
    if (version !== current) navigate(`/${version.path}`);
  }

  return (
    <div ref={container} onKeyDown={onKeyDown} className="relative inline-flex print:hidden">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        title={onLatest ? "The latest version of this node" : `An older version. The latest is ${latest.label}.`}
        onClick={() => setOpen((was) => !was)}
        className={cn(
          "inline-flex cursor-interactive items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium transition-colors",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
          onLatest
            ? "border-transparent text-neutral-500 hover:text-foreground"
            : "border-brand/40 bg-brand/10 text-brand-700 dark:text-brand-bright",
        )}
      >
        {named(current.label)}
        <ChevronDown
          className={cn("size-3 transition-transform duration-150 motion-reduce:transition-none", open && "rotate-180")}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div ref={menu} role="listbox" aria-label="Versions of this node" className={cn(MENU_PANEL, "w-48")}>
          {versions.map((version) => (
            <button
              key={version.path}
              type="button"
              role="option"
              aria-selected={version === current}
              onClick={() => pick(version)}
              className={cn(MENU_ITEM, version === current && "text-brand-700 dark:text-brand-bright")}
            >
              <Check className={cn(MENU_ICON, "text-current", version !== current && "invisible")} aria-hidden="true" />
              {named(version.label)}
              {version === latest && version.label !== "Latest" && (
                <span className="ml-auto text-caption text-neutral-500">Latest</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

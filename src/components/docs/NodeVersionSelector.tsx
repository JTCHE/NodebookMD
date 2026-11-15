import { Check, ChevronDown } from "lucide-react";
import { useNavigate } from "react-router";
import { Hint } from "@/components/ui/Hint";
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
    <Hint side="below" label={onLatest ? "The latest version of this node" : `An older version. The latest is ${latest.label}.`}>
    <div ref={container} onKeyDown={onKeyDown} className="relative -ml-2 mr-xs inline-flex print:hidden">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        className={cn(
          // A ghost picker like Copy; only an older version is marked.
          "inline-flex h-6 cursor-interactive items-center gap-1 rounded-md border px-2 text-xs transition-colors [corner-shape:squircle] active:bg-neutral-200",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-neutral-400",
          onLatest
            ? "border-transparent text-neutral-600 hover:bg-muted hover:text-foreground"
            : "border-transparent bg-brand/10 text-brand-700 dark:text-brand-bright",
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
              className={cn(MENU_ITEM, version === current && "text-foreground")}
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
    </Hint>
  );
}

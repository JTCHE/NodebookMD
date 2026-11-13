import { useLayoutEffect, useState, type MouseEvent } from "react";
import { ChevronRight, Link2 } from "lucide-react";
import { Hint } from "@/components/ui/Hint";
import type { Components } from "react-markdown";
import { useLocation } from "react-router";
import { showToast } from "@/components/ui/toast-notification";
import { pageLink } from "@/lib/link";
import { cn } from "@/lib/utils";
import { isCollapsed, sectionKey, sectionOf, setCollapsed } from "@/lib/ui/sections";
import { Icons } from "@/lib/ui/icons";
import { BAR_BUTTON } from "@/lib/ui/button";

type Tag = "h2" | "h3" | "h4";

/** A section heading with a button that copies a link to it, in the form
    Settings names, and one that collapses the section under it. */
function heading(Tag: Tag): NonNullable<Components[Tag]> {
  return function MarkdownHeading({ node: _node, children, ...props }) {
    const location = useLocation();
    const ownKey = props.id ? sectionKey(location.pathname.replace(/^\/+/, ""), props.id) : "";
    const [closed, setClosed] = useState(() => ownKey !== "" && isCollapsed(ownKey));
    // Whether the heading owns content to collapse: a heading that runs
    // straight into the next one owns nothing, and is not a control.
    const [collapsible, setCollapsible] = useState(false);
    // The first heading of a class's methods carries the switch that opens
    // or closes every method, own and inherited.
    const [methodsBox, setMethodsBox] = useState<HTMLElement | null>(null);
    const [allOpen, setAllOpen] = useState(false);
    useLayoutEffect(() => {
      const owner = props.id ? document.getElementById(props.id) : null;
      setCollapsible(!!owner && !!sectionOf(owner));
      const box = owner?.parentElement;
      setMethodsBox(box?.matches(".hom-methods") && box.firstElementChild === owner ? box : null);
      if (owner && closed) setCollapsed(owner, ownKey, true);
    }, [ownKey]);
    const apply = (owner: HTMLElement, next: boolean) => {
      if (setCollapsed(owner, ownKey, next)) setClosed(next);
    };
    // Clicking the heading collapses the section, the way the chevron does.
    // A drag that ends on the heading selects text; that is not a collapse.
    const onHeadingClick = (event: MouseEvent<HTMLElement>) => {
      if (window.getSelection()?.toString()) return;
      apply(event.currentTarget, !isCollapsed(ownKey));
    };
    const onToggleClick = (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      const owner = event.currentTarget.parentElement;
      if (owner) apply(owner, !isCollapsed(ownKey));
    };
    const toggleAll = (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      if (!methodsBox) return;
      for (const row of methodsBox.querySelectorAll<HTMLDetailsElement>("details.hom-method")) row.open = !allOpen;
      setAllOpen(!allOpen);
    };
    const AllIcon = allOpen ? Icons.collapseAll : Icons.expandAll;
    const copy = (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      const path = location.pathname.replace(/^\/+/, "");
      void pageLink(path, props.id).then((link) => navigator.clipboard.writeText(link)).then(
        () => showToast("Copied the link to this section"),
        () => showToast("Could not copy the link", "error"),
      );
    };
    return (
      <Tag
        {...props}
        className={cn(
          "relative",
          ownKey && collapsible &&
            "cursor-interactive pointer-hover:text-neutral-800 transition-colors duration-(--duration-fast) motion-reduce:transition-none",
          props.className,
        )}
        onClick={ownKey && collapsible ? onHeadingClick : undefined}
      >
        {props.id && (
          <button
            type="button"
            aria-expanded={!closed}
            aria-label={closed ? "Expand this section" : "Collapse this section"}
            onClick={onToggleClick}
            className="section-toggle absolute top-1/2 right-full size-5 -translate-y-1/2 inline-flex cursor-interactive items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 after:absolute after:-inset-2 after:content-['']"
          >
            <ChevronRight className="size-3.5" aria-hidden="true" />
          </button>
        )}
        {children}
        {props.id && (
          <Hint label="Copy the link to this section">
          <button
            type="button"
            aria-label="Copy the link to this section"
            onClick={copy}
            className="heading-copy relative ml-2 inline-flex size-5 cursor-interactive items-center justify-center rounded-sm align-baseline text-muted-foreground transition-[opacity,color] duration-150 after:absolute after:-inset-2 after:content-[''] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 motion-reduce:transition-none"
          >
            <Link2 className="size-[0.75em]" aria-hidden="true" />
          </button>
          </Hint>
        )}
        {methodsBox && (
          // The box ends on the method rows' right edge.
          <Hint label={allOpen ? "Collapse all methods" : "Expand all methods"} className="absolute top-1/2 -right-[calc(1rem+1px)] -translate-y-1/2">
            <button
              type="button"
              aria-label={allOpen ? "Collapse all methods" : "Expand all methods"}
              onClick={toggleAll}
              className={BAR_BUTTON}
            >
              <AllIcon className="size-4" aria-hidden="true" />
            </button>
          </Hint>
        )}
      </Tag>
    );
  };
}

export const H2 = heading("h2");
export const H3 = heading("h3");
export const H4 = heading("h4");

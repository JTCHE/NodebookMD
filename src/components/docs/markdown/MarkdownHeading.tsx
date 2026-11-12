import { useLayoutEffect, useState, type MouseEvent } from "react";
import { ChevronRight, Link2 } from "lucide-react";
import { Hint } from "@/components/ui/Hint";
import type { Components } from "react-markdown";
import { useLocation } from "react-router";
import { showToast } from "@/components/ui/toast-notification";
import { pageLink } from "@/lib/link";
import { cn } from "@/lib/utils";
import { isCollapsed, sectionKey, sectionOf, setCollapsed } from "@/lib/ui/sections";

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
    useLayoutEffect(() => {
      const owner = props.id ? document.getElementById(props.id) : null;
      setCollapsible(!!owner && !!sectionOf(owner));
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
      </Tag>
    );
  };
}

export const H2 = heading("h2");
export const H3 = heading("h3");
export const H4 = heading("h4");

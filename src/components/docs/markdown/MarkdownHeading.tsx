import { Link2 } from "lucide-react";
import { Hint } from "@/components/ui/Hint";
import type { Components } from "react-markdown";
import { useLocation } from "react-router";
import { showToast } from "@/components/ui/toast-notification";
import { pageLink } from "@/lib/link";

type Tag = "h2" | "h3" | "h4";

/** A section heading with a button that copies a link to it, in the form
    Settings names. */
function heading(Tag: Tag): NonNullable<Components[Tag]> {
  return function MarkdownHeading({ node: _node, children, ...props }) {
    const location = useLocation();
    const copy = () => {
      const path = location.pathname.replace(/^\/+/, "");
      void pageLink(path, props.id).then((link) => navigator.clipboard.writeText(link)).then(
        () => showToast("Copied the link to this section"),
        () => showToast("Could not copy the link", "error"),
      );
    };
    return (
      <Tag {...props}>
        {children}
        {props.id && (
          <Hint label="Copy the link to this section">
          <button
            type="button"
            aria-label="Copy the link to this section"
            onClick={copy}
            className="heading-copy ml-2 inline-flex translate-y-[0.1em] cursor-interactive rounded-sm p-0.5 align-baseline text-muted-foreground transition-[opacity,color] duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 motion-reduce:transition-none"
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

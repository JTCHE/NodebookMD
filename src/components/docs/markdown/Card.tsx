import DocLink from "@/components/docs/DocLink";
import { usePageMark } from "@/components/docs/Tooltip";
import DocIconClient from "./DocIconClient";

type HastNode = {
  type?: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

function text(node: HastNode): string {
  return node.type === "text" ? (node.value ?? "") : (node.children?.map(text).join("") ?? "");
}

/** The one link a list item holds, when the item holds nothing else — the
    shape of every `@related` list on a node page. A bullet like that names a
    page, so it gets the page's own name and not the help's internal one. */
function onlyLink(node?: HastNode): HastNode | null {
  const content = (node?.children ?? []).filter(
    (child) => child.tagName || (child.type === "text" && (child.value ?? "").trim()),
  );
  const [one] = content.length === 1 && content[0].tagName === "p" ? [content[0]] : [node];
  const inner = (one?.children ?? []).filter(
    (child) => child.tagName || (child.type === "text" && (child.value ?? "").trim()),
  );
  return inner.length === 1 && inner[0].tagName === "a" ? inner[0] : null;
}

/** A bullet that is one link to one page.
 *
 *  The help writes a `@related` list as bare internal names — `attribcreate`,
 *  `kinefx--agentfromrig` — which is what the file system calls the page, not
 *  what the page calls itself. The reader gets the page's own title instead,
 *  and the internal name is kept only where the help wrote something else. */
function PageBullet({ href, label }: { href: string; label: string }) {
  const slug = href.replace(/^#?\/+/, "").split("#")[0] || null;
  const mark = usePageMark(slug);
  const named = /^[a-z0-9][a-z0-9_-]*$/.test(label);
  const name = named && mark?.title ? mark.title : label;
  return (
    <DocLink href={href}>{name}</DocLink>
  );
}

export function Card({ node, children, ...props }: React.ComponentProps<"li"> & { node?: HastNode }) {
  if (!node?.properties?.dataCard) {
    const link = onlyLink(node);
    const href = typeof link?.properties?.href === "string" ? link.properties.href : null;
    // Only a link to a page in the help. An address off the machine has no
    // page here to name.
    if (href && !/^[a-z]+:/i.test(href)) {
      return (
        <li {...props}>
          <PageBullet href={href} label={text(link!)} />
        </li>
      );
    }
    return <li {...props}>{children}</li>;
  }

  // A single-item card grid with no description parses as a "tight" list
  // (CommonMark only wraps item content in <p> when a blank line separates
  // blocks), so the link/icon land directly under <li> instead of under a
  // <p>. Fall back to the li itself as the title source in that case.
  const paragraphs = node.children?.filter((child) => child.tagName === "p") ?? [];
  const [title, summary] = paragraphs.length ? paragraphs : [node];
  const link = title?.children?.find((child) => child.tagName === "a");
  const icon =
    link?.children?.find((child) => child.tagName === "img") ?? title?.children?.find((child) => child.tagName === "img");
  const href = typeof link?.properties?.href === "string" ? link.properties.href : undefined;
  // Without the size the page writes after a picture's address.
  const iconSrc = typeof icon?.properties?.src === "string" ? icon.properties.src.split("#")[0] : undefined;
  const summaryText = summary && text(summary);

  return (
    <li {...props}>
      <p>
        {href ? (
          <DocLink
            href={href}
            underline={false}
            mark={false}
          >
            {iconSrc && (
              <DocIconClient
                src={iconSrc}
                alt=""
              />
            )}
            {text(link!)}
          </DocLink>
        ) : (
          <>
            {iconSrc && (
              <DocIconClient
                src={iconSrc}
                alt=""
              />
            )}
            {text(title!)}
          </>
        )}
      </p>
      {summaryText && /[a-z]/i.test(summaryText) && <p>{summaryText}</p>}
    </li>
  );
}

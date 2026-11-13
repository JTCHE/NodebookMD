import type { Components } from "react-markdown";
import DocLink from "@/components/docs/DocLink";
import { CodeBlock, CodePanel } from "@/components/docs/CodeBlock";
import { Table, Th, Td } from "./MarkdownTable";
import { Blockquote } from "./MarkdownBlockquote";
import { Code } from "./MarkdownCode";
import { Image } from "./MarkdownImage";
import { Video } from "./MarkdownVideo";
import { Card } from "./Card";
import { ImageGroup } from "./ImageGroup";
import { Vimeo } from "./MarkdownVimeo";
import { LaunchExample } from "@/components/docs/LaunchExample";
import { MethodFilter } from "@/components/docs/MethodFilter";
import { H2, H3, H4 } from "./MarkdownHeading";

/** The parser writes a `.code-panel` that carries the copy button and the
    highlighting, an `.image-group` row of pictures, `.columns` of `:col:`
    blocks, and a `.vimeo` clip, and a `.load-example` Launch button. */
const Div: Components["div"] = function MarkdownDiv({ className, children, ...props }) {
  const kinds = className?.split(" ") ?? [];
  if (kinds.includes("image-group")) {
    return <ImageGroup className={className!}>{children}</ImageGroup>;
  }
  if (kinds.includes("load-example")) {
    return <LaunchExample path={String((props as Record<string, unknown>)["data-path"] ?? "")} />;
  }
  if (kinds.includes("hom-method-filter")) {
    return <MethodFilter />;
  }
  if (kinds.includes("vimeo")) {
    return <Vimeo id={String((props as Record<string, unknown>)["data-id"] ?? "")} title={props.title} />;
  }
  return kinds.includes("code-panel") ? (
    <CodePanel>
      <div className={className} {...props}>{children}</div>
    </CodePanel>
  ) : (
    <div className={className} {...props}>{children}</div>
  );
};

/** Single source of truth for how docs markdown renders. */
export const markdownComponents: Components = {
  h1: ({ children }) => (
    <h1 className="not-prose text-2xl font-bold tracking-tight border-b border-border pb-3 mb-6 mt-0">{children}</h1>
  ),
  h2: H2,
  h3: H3,
  h4: H4,
  blockquote: Blockquote,
  div: Div,
  table: Table,
  th: Th,
  td: Td,
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  code: Code,
  img: Image,
  video: Video,
  li: Card,
  figcaption: ({ children }) => <figcaption className="mt-2 px-4 text-left text-sm text-muted-foreground">{children}</figcaption>,
  a: ({ href, className, children, ...props }) => {
    const classes = Array.isArray(className) ? className : typeof className === "string" ? className.split(" ") : [];
    return href ? (
      <DocLink
        href={href}
        className={classes.length ? classes.join(" ") : undefined}
        // A signature argument link is part of the code around it: it wears
        // no page mark, only its token.
        mark={!classes.includes("vex-sig-arg")}
        {...props}
      >
        {children}
      </DocLink>
    ) : (
      <span {...(props as React.HTMLAttributes<HTMLSpanElement>)}>{children}</span>
    );
  },
};

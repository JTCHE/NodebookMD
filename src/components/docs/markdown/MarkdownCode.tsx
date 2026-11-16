import type { Components } from "react-markdown";

/** Block code is styled entirely by globals.css (the <pre> goes through
 *  CodeBlock); only inline spans get classes here. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const Code: Components["code"] = ({ className, children, node: _node, ...props }) => {
  const isBlock = !!className?.startsWith("language-") || (typeof children === "string" && children.includes("\n"));
  if (isBlock) {
    return (
      <code
        className={className ?? ""}
        {...props}
      >
        {children}
      </code>
    );
  }
  return (
    // Neutral ink: pink is a VEX binding in a code panel, so it must not
    // also mean "any code" in the prose around it.
    <code
      className="bg-muted px-1.5 py-0.5 text-sm font-mono border border-border/50 rounded-sm text-foreground [overflow-wrap:anywhere] whitespace-normal"
      {...props}
    >
      {children}
    </code>
  );
};

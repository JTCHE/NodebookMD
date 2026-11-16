import { useCallback, useLayoutEffect, useRef, useState } from "react";
import hljs from "highlight.js/lib/core";
import c from "highlight.js/lib/languages/c";
import python from "highlight.js/lib/languages/python";
import type { CodeLanguage } from "@/lib/markdown/types";
import "./CodeBlock.css";

const withFunctionCalls = (languageFactory: typeof c) => (highlightJs: Parameters<typeof c>[0]) => {
  const language = languageFactory(highlightJs);
  // The language files name keywords, strings and numbers only. These add
  // the names a reader tracks, as an editor colours them: a class made by a
  // call, a function call, a name that takes a value, an object before a
  // dot, and a member after one.
  language.contains.unshift(
    { className: "title class_", begin: /\b[A-Z]\w*(?=\s*\()/, relevance: 0 },
    { className: "title function_", begin: /\b[A-Za-z_]\w*(?=\s*\()/, relevance: 0 },
    { className: "variable", begin: /\b[A-Za-z_]\w*(?=\s*=(?!=))/, relevance: 0 },
    { className: "variable", begin: /\b[a-z_]\w*(?=\.[A-Za-z_])/, relevance: 0 },
    { className: "property", begin: /(?<=\.)[A-Za-z_]\w*\b/, relevance: 0 },
  );
  // Any other lower-case name is a variable, except a word the language
  // itself owns. The language's own lists say which words those are.
  const owned = Object.entries((language.keywords ?? {}) as Record<string, unknown>)
    .filter(([kind]) => kind !== "$pattern")
    .flatMap(([, words]) => (typeof words === "string" ? words.split(/\s+/) : Array.isArray(words) ? words : []))
    .map(String)
    .map((word) => word.split("|")[0])
    .filter((word) => /^\w+$/.test(word));
  language.contains.push({
    className: "variable",
    begin: new RegExp(`\\b(?!(?:${owned.join("|")})\\b)[a-z_]\\w*\\b`),
    relevance: 0,
  });
  return language;
};

hljs.registerLanguage("c", withFunctionCalls(c));
hljs.registerLanguage("python", withFunctionCalls(python));
hljs.registerAliases(["vex", "hscript", "cpp", "c++"], { languageName: "c" });

interface CodePanelProps {
  children: React.ReactNode;
  language?: CodeLanguage;
}

/** Shared panel behavior for fenced examples and VEX signature cards. */
export function CodePanel({ children, language }: CodePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useLayoutEffect(() => {
    const code = panelRef.current?.querySelector("code");
    if (!code || (code as HTMLElement).dataset.highlighted) return;
    // A block that names its own language (`#!python` in the source) keeps
    // it. The page's language is for a block that names none.
    if (language && !/language-/.test(code.className)) code.className = `language-${language}`;
    hljs.highlightElement(code as HTMLElement);
  }, [language]);

  // A panel that scrolls hangs its bar over the code's bottom padding instead
  // of adding a lip under it: the last row gives back the bar's height. The
  // height is read, not assumed, because the bar is the platform's.
  useLayoutEffect(() => {
    const scroller = panelRef.current?.querySelector<HTMLElement>(".code-panel");
    const last = scroller?.lastElementChild as HTMLElement | null | undefined;
    if (!scroller || !last) return;
    const hang = () => {
      const bar = scroller.offsetHeight - scroller.clientHeight - 2 * scroller.clientTop;
      last.style.marginBottom = bar > 0 ? `${-bar}px` : "";
    };
    const observer = new ResizeObserver(hang);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);

  const handleCopy = useCallback(async () => {
    const panel = panelRef.current;
    if (!panel) return;
    const signatureRows = panel.querySelectorAll<HTMLElement>(".vex-signature-row");
    const targets = signatureRows.length ? signatureRows : panel.querySelectorAll<HTMLElement>("code");
    const text = Array.from(targets, (target) => target.innerText).join("\n");

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      // The browser does not provide clipboard access.
    }
  }, []);

  return (
    <div
      ref={panelRef}
      className="group relative"
    >
      <button
        type="button"
        onClick={(handleCopy)}
        aria-label="Copy code"
        data-copied={copied || undefined}
        className="code-copy absolute cursor-interactive right-2 top-2 select-none rounded-md border border-white/15 bg-white/10 px-2.5 py-1 text-xs font-medium text-white/70 backdrop-blur-sm transition-all duration-150 hover:bg-white/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 active:scale-95"
      >
        {copied ? "Copied" : "Copy"}
      </button>
      {children}
    </div>
  );
}

export function CodeBlock({ children, language }: CodePanelProps) {
  return (
    // Negative margin cancels the panel's own inset (1rem padding + the
    // .code-panel 1px border) so the glyphs land on the shared text axis —
    // same 1rem step the VEX signature panel already uses, see globals.css.
    <div className="not-prose my-4 -mx-[calc(1rem_+_1px)]">
      <CodePanel language={language}>
        <pre className="code-panel">{children}</pre>
      </CodePanel>
    </div>
  );
}

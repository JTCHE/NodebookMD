import { Check, ChevronDown, Copy, Download, FileText, Link2, SquareArrowOutUpRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { MENU_PANEL, useMenu } from "@/lib/ui/menu";
import { ACTION, QUIET } from "@/lib/ui/button";
import { MenuList, type MenuEntry } from "@/components/ui/MenuList";
import { sideFxUrl } from "@/lib/sidefx";
import { pageLink } from "@/lib/link";
import { invoke, inTauri } from "@/lib/backend";
import { pageHtml } from "@/lib/markdown/html";
import { showToast } from "@/components/ui/toast-notification";
import { COMMAND_KEY, isCommand, isTyping, useHotkey } from "@/lib/hotkeys";
import { Hint } from "@/components/ui/Hint";
import { used } from "@/lib/telemetry";
import { openWeb } from "@/lib/web";
import { setPageActions } from "@/lib/page-actions";
import { hasMedia, picturesChoice, rememberedVault, sendText, sendWithPictures } from "@/lib/obsidian";
import { ObsidianDialog } from "@/components/obsidian/ObsidianDialog";

function ClaudeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z" />
    </svg>
  );
}

function ChatGPTIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" />
    </svg>
  );
}


function ObsidianIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M19.355 18.538a68.967 68.959 0 0 0 1.858-2.954.81.81 0 0 0-.062-.9c-.516-.685-1.504-2.075-2.042-3.362-.553-1.321-.636-3.375-.64-4.377a1.707 1.707 0 0 0-.358-1.05l-3.198-4.064a3.744 3.744 0 0 1-.076.543c-.106.503-.307 1.004-.536 1.5-.134.29-.29.6-.446.914l-.31.626c-.516 1.068-.997 2.227-1.132 3.59-.124 1.26.046 2.73.815 4.481.128.011.257.025.386.044a6.363 6.363 0 0 1 3.326 1.505c.916.79 1.744 1.922 2.415 3.5zM8.199 22.569c.073.012.146.02.22.02.78.024 2.095.092 3.16.29.87.16 2.593.64 4.01 1.055 1.083.316 2.198-.548 2.355-1.664.114-.814.33-1.735.725-2.58l-.01.005c-.67-1.87-1.522-3.078-2.416-3.849a5.295 5.295 0 0 0-2.778-1.257c-1.54-.216-2.952.19-3.84.45.532 2.218.368 4.829-1.425 7.531zM5.533 9.938c-.023.1-.056.197-.098.29L2.82 16.059a1.602 1.602 0 0 0 .313 1.772l4.116 4.24c2.103-3.101 1.796-6.02.836-8.3-.728-1.73-1.832-3.081-2.55-3.831zM9.32 14.01c.615-.183 1.606-.465 2.745-.534-.683-1.725-.848-3.233-.716-4.577.154-1.552.7-2.847 1.235-3.95.113-.235.223-.454.328-.664.149-.297.288-.577.419-.86.217-.47.379-.885.46-1.27.08-.38.08-.72-.014-1.043-.095-.325-.297-.675-.68-1.06a1.6 1.6 0 0 0-1.475.36l-4.95 4.452a1.602 1.602 0 0 0-.513.952l-.427 2.83c.672.59 2.328 2.316 3.335 4.711.09.21.175.43.253.653z" />
    </svg>
  );
}

/**
 * Copies the page as Markdown. The app already holds the Markdown, so the
 * button never asks anything of the network. ⌘C does the same. The arrow
 * beside it holds the other ways to take the page out of the app.
 */
export function MarkdownActions({ markdown, path, title }: { markdown: string; path: string; title: string }) {
  const [copied, setCopied] = useState(false);
  const [asking, setAsking] = useState(false);
  const { open, setOpen, container, menu, trigger: arrow, onKeyDown: onMenuKey } = useMenu();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const button = useRef<HTMLButtonElement>(null);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      return true;
    } catch {
      showToast("Couldn't copy markdown", "error");
      return false;
    }
  }, [markdown]);

  const celebrate = useCallback(() => {
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  }, []);

  // Global Ctrl/Cmd+C — copies the whole page markdown UNLESS the reader is
  // copying a real text selection or typing in a field. Native copy of a
  // selection wins; only an "empty" Ctrl+C copies the page.
  useHotkey((event) => {
    if (event.key !== "c" || !isCommand(event) || event.shiftKey || event.altKey) return;
    if (window.getSelection()?.toString().trim()) return;
    if (isTyping(event.target)) return;
    event.preventDefault();

    // If the copy button is on screen, animate it as feedback — the same as a
    // click. Scrolled past the fold there is nothing to animate, so say it in
    // a toast instead.
    const rect = button.current?.getBoundingClientRect();
    const onScreen = !!rect && rect.bottom > 0 && rect.top < window.innerHeight;

    void copy().then((done) => {
      if (!done) return;
      if (onScreen) celebrate();
      else showToast("Markdown copied to clipboard");
    });
  });

  // Saving the page: the header menu, Ctrl+S and the right-click menu all
  // come here, so all three write the same file. The reader's chosen
  // name picks the form, so both shapes are made before the dialog opens.
  const save = useCallback(async () => {
    const name = path.split("/").pop() || "page";
    const html = await pageHtml({ title, source: sideFxUrl(path) });
    if (await invoke<boolean>("save_page", { name, markdown, html })) showToast("Page saved");
  }, [markdown, path, title]);


  // A page with no pictures goes as text, with no question. One with pictures
  // asks whether to bring them, unless the reader kept an answer. See lib/obsidian.
  const toObsidian = useCallback(async () => {
    const choice = hasMedia(markdown) ? await picturesChoice() : "text";
    const vault = choice === "bring" ? await rememberedVault() : null;
    if (choice === "ask" || (choice === "bring" && !vault)) return setAsking(true);
    if (vault) await sendWithPictures(vault, title, markdown);
    else await sendText(title, markdown);
    showToast("Sent to Obsidian");
  }, [markdown, title]);

  // Ctrl/Cmd+S. The webview binds it to its own "save page", which writes the
  // app's HTML shell, so the press is taken here whether or not it is used.
  useHotkey((event) => {
    if (event.key !== "s" || !isCommand(event) || event.shiftKey || event.altKey) return;
    if (isTyping(event.target)) return;
    event.preventDefault();
    if (!inTauri) return;
    used("save-as");
    void save().catch((reason) => showToast(String(reason), "error"));
  });

  // Ctrl/Cmd+L copies the page's link, in the form Settings names.
  const copyLink = useCallback(async () => {
    await navigator.clipboard.writeText(await pageLink(path));
    showToast("Link copied");
  }, [path]);
  useHotkey((event) => {
    if (event.key.toLowerCase() !== "l" || !isCommand(event) || event.shiftKey || event.altKey) return;
    if (isTyping(event.target)) return;
    event.preventDefault();
    void copyLink().catch(() => showToast("Couldn't copy", "error"));
  });

  // Every action on the page, once: the drop-down below and the right-click
  // menu draw from this.
  const actions = useMemo(() => {
    const named = (name: string, entry: MenuEntry): MenuEntry => ({
      ...entry,
      run: () => {
        used(name);
        return entry.run();
      },
    });
    // The same short request both assistants get: read this page, then answer.
    const prompt =
      `Please read the Houdini docs page for "${title}" at ${sideFxUrl(path)}.

` +
      "Concisely tell me about it using Simplified Technical English (ASD-STE100).";
    return {
      path,
      title,
      copy,
      copyLink: named("copy-link", { label: "Copy page link", icon: Link2, keys: `${COMMAND_KEY}+L`, run: copyLink }),
      openOnSideFx: named("open-sidefx", { label: "Open on sidefx.com", icon: SquareArrowOutUpRight, run: () => openWeb(sideFxUrl(path)) }),
      openMarkdown: named("open-markdown", {
        label: "Open as Markdown",
        icon: SquareArrowOutUpRight,
        run: () => (inTauri ? invoke("open_page", { path, source: false }) : window.open(`/${path}.md`, "_blank")),
      }),
      ...(inTauri && {
        openSource: named("open-source", { label: "Open the help source", icon: FileText, run: () => invoke("open_page", { path, source: true }) }),
        save: named("save-as", { label: "Save as…", icon: Download, keys: `${COMMAND_KEY}+S`, run: save }),
        obsidian: named("send-to-obsidian", { label: "Send to Obsidian", icon: ObsidianIcon, run: toObsidian }),
      }),
      askClaude: named("ask-assistant", {
        label: "Ask Claude",
        icon: ClaudeIcon,
        run: () => openWeb(`https://claude.ai/new?q=${encodeURIComponent(prompt)}`),
      }),
      askChatGpt: named("ask-assistant", {
        label: "Ask ChatGPT",
        icon: ChatGPTIcon,
        run: () => openWeb(`https://chatgpt.com/?q=${encodeURIComponent(prompt)}`),
      }),
    };
  }, [path, title, copy, copyLink, save, toObsidian]);

  useEffect(() => {
    setPageActions(actions);
    return () => setPageActions(null);
  }, [actions]);

  return (
    <div ref={container} onKeyDown={onMenuKey} className="relative inline-flex print:hidden">
      <Hint label="Copy as Markdown" keys={`${COMMAND_KEY}+C`}>
      <button
        ref={button}
        type="button"
        onClick={(() => {
          used("copy-markdown");
          void copy().then((done) => done && celebrate());
        })}
        // In a tight column the button keeps its icon and gives its words to
        // the page title. The header is the container.
        aria-label={copied ? "Copied" : "Copy as Markdown"}
        className={cn(ACTION, QUIET, "rounded-r-none px-2.5 @min-[600px]:px-3")}
      >
        {copied ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
        <span className="hidden @min-[600px]:inline">{copied ? "Copied" : "Copy as Markdown"}</span>
      </button>
      </Hint>
      <Hint label="More">
      <button
        ref={arrow}
        type="button"
        aria-label="More ways to take this page"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        className={cn(ACTION, QUIET, "w-7 rounded-l-none border-l-0 px-0")}
      >
        <ChevronDown
          className={cn("size-3.5 transition-transform duration-150 motion-reduce:transition-none", open && "rotate-180")}
          aria-hidden="true"
        />
      </button>
      </Hint>

      {open && (
        <MenuList
          ref={menu}
          label="Page actions"
          className={cn(MENU_PANEL, "min-w-52")}
          onClose={() => {
            setOpen(false);
            arrow.current?.focus();
          }}
          groups={[
            [actions.openMarkdown, actions.openSource, actions.save, actions.obsidian].filter((entry) => entry !== undefined),
            [actions.askClaude, actions.askChatGpt],
          ]}
        />
      )}
      {asking && <ObsidianDialog title={title} markdown={markdown} onClose={() => setAsking(false)} />}
    </div>
  );
}

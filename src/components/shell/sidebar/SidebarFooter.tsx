/**
 * The bottom of the panel: the trail the reader has left, then the two
 * controls that belong to the app rather than to the documentation.
 *
 * It is pinned to the bottom rather than following the tree, so settings and
 * the theme switch are in the same place whether the tree is open or shut.
 */
import { SETTINGS_KEYS, openSettings } from "@/components/settings/SettingsDialog";
import { cn } from "@/lib/utils";
import { Icons } from "@/lib/ui/icons";
import { THEME_ICON, THEME_LABEL, cycleTheme, useThemeChoice } from "@/lib/ui/theme";
import { Hint } from "@/components/ui/Hint";
import { SidebarRow } from "./SidebarRow";
import { version } from "../../../../src-tauri/tauri.conf.json";

/* Bugs go to GitHub issues, in the reader's own browser. See spec: Bug Filing Button. */
const ISSUES = "https://github.com/JTCHE/NodebookMD/issues/new";

/* Square, with the 16px glyph 8px in, as a row pads: the first one
   stands on the panel's axis. */
const FOOTER_BUTTON =
  "grid size-[32px] cursor-interactive place-items-center rounded-md text-neutral-500 " +
  "transition-colors duration-(--duration-fast) motion-reduce:transition-none " +
  "pointer-hover:bg-raised pointer-hover:text-neutral-900 pointer-hover:shadow-chip active:bg-neutral-200 " +
  // Disabled changes what it DOES, not how loud it is: the two controls sit
  // side by side and a dimmed one beside a lit one reads as a rendering bug.
  "disabled:cursor-default " +
  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

interface SidebarFooterProps {
  recentCount: number;
  recentsOpen: boolean;
  onToggleRecents: () => void;
  className?: string;
}

export function SidebarFooter({ recentCount, recentsOpen, onToggleRecents, className }: SidebarFooterProps) {
  const theme = useThemeChoice();
  const ThemeMark = THEME_ICON[theme];

  return (
    <div className={cn("flex flex-col", className)}>
      {/* Not a header row: the clock and the word sit on the same axis and at
          the same weight as the pages above them, because Recents is a place
          to go and not a label over a list. */}
      <SidebarRow
        label="Recents"
        mark={<Icons.recent className={cn("size-[15px]", recentsOpen ? "text-neutral-800" : "text-neutral-500")} />}
        disclosure={recentsOpen ? "expanded" : "collapsed"}
        active={recentsOpen}
        count={recentCount}
        onClick={onToggleRecents}
      />

      {/* The two that change the app side by side; the bug report, which
          leaves it, apart in the far corner. */}
      {/* One full rule between the trail and the app's own controls. */}
      <div className="mt-xs flex items-center gap-[2px] border-t border-hairline pt-sm">
        <Hint label="Settings" keys={SETTINGS_KEYS}>
          <button type="button" aria-label="Settings" className={FOOTER_BUTTON} onClick={openSettings}>
            <Icons.settings className="size-4" />
          </button>
        </Hint>
        {/* Three choices, so the mark is the one in force and a press steps to
            the next. Settings has the three side by side. */}
        <Hint label={`${THEME_LABEL[theme]} theme`}>
        <button
          type="button"
          aria-label={`Theme: ${THEME_LABEL[theme]}. Press for the next one.`}
          className={FOOTER_BUTTON}
          onClick={cycleTheme}
        >
          <ThemeMark className="size-4" />
        </button>
        </Hint>
        <span className="flex-1" />
        {/* Which build of the app this is: read, not pressed, so it is text
            beside the one control that leaves the app. */}
        <span className="mr-2xs text-[11px] text-neutral-400 tabular-nums">v{version}</span>
        <Hint label="File a bug on GitHub">
          <a href={ISSUES} target="_blank" rel="noopener noreferrer" aria-label="File a bug" className={FOOTER_BUTTON}>
            <Icons.bugReport className="size-4" />
          </a>
        </Hint>
      </div>
    </div>
  );
}

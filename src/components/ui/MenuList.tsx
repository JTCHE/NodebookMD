/**
 * The items of every menu in the app: the right-click menu and the page
 * header's drop-down draw through this, so an item looks, reads and answers
 * its keys the same way in both.
 *
 * Each item gets a letter, underlined, that runs it (`accelerators`). The
 * arrows walk the items, Escape and Tab close the menu.
 */
import { forwardRef, type ComponentType, type ReactNode } from "react";
import { accelerators, MENU_ICON, MENU_ITEM } from "@/lib/ui/menu";
import { showToast } from "@/components/ui/toast-notification";
import { cn } from "@/lib/utils";
import { Keys } from "@/components/ui/Keycap";

export interface MenuEntry {
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** The keys that run it outside the menu, drawn on the right. */
  keys?: string;
  disabled?: boolean;
  run: () => unknown;
}

/** Groups, drawn with a line between them. */
export type MenuGroups = MenuEntry[][];

export const MenuList = forwardRef<
  HTMLDivElement,
  {
    groups: MenuGroups;
    label: string;
    /** Called before an item runs, and on Escape or Tab. */
    onClose: () => void;
    /** Called when an item runs, for the usage count. */
    onRun?: () => void;
    className?: string;
    style?: React.CSSProperties;
  }
>(function MenuList({ groups, label, onClose, onRun, className, style }, ref) {
  const items = groups.flat();
  const letters = accelerators(items.map((item) => item.label));

  function run(item: MenuEntry) {
    onClose();
    onRun?.();
    void Promise.resolve()
      .then(item.run)
      .catch((reason) => showToast(String(reason), "error"));
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const key = event.key.toLowerCase();
    const hit = items.findIndex((item, i) => letters[i] >= 0 && item.label[letters[i]].toLowerCase() === key);
    if (hit >= 0 && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      event.stopPropagation();
      if (!items[hit].disabled) run(items[hit]);
      return;
    }
    const buttons = [...event.currentTarget.querySelectorAll<HTMLElement>("[role=menuitem]:not(:disabled)")];
    const now = buttons.indexOf(document.activeElement as HTMLElement);
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (step) {
      event.preventDefault();
      event.stopPropagation();
      const next = now < 0 ? (step > 0 ? 0 : buttons.length - 1) : (now + step + buttons.length) % buttons.length;
      buttons[next]?.focus();
    } else if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  }

  const rows: ReactNode[] = [];
  let n = 0;
  groups.forEach((group, index) => {
    if (index > 0) rows.push(<div key={`line-${index}`} role="separator" className="mx-sm my-1 h-px bg-hairline" />);
    for (const item of group) {
      const Icon = item.icon;
      const letter = letters[n++];
      rows.push(
        <button
          key={`${index}-${item.label}`}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          className={cn(MENU_ITEM, "disabled:pointer-events-none disabled:text-neutral-400")}
          aria-keyshortcuts={letter >= 0 ? item.label[letter].toUpperCase() : undefined}
          onClick={() => run(item)}
        >
          <Icon className={cn(MENU_ICON, item.disabled && "text-neutral-300")} />
          <span className="flex-1 whitespace-nowrap">
            {letter < 0 ? (
              item.label
            ) : (
              <>
                {item.label.slice(0, letter)}
                <u className="underline-offset-2">{item.label[letter]}</u>
                {item.label.slice(letter + 1)}
              </>
            )}
          </span>
          {item.keys && <Keys keys={item.keys} className="ml-auto pl-md" />}
        </button>,
      );
    }
  });

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => event.preventDefault()}
      style={style}
      className={cn("rounded-lg border border-hairline bg-raised p-1 shadow-xl shadow-black/10 outline-none pop-in", className)}
    >
      {rows}
    </div>
  );
});

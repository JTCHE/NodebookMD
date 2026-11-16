/**
 * Which vault "Send to Obsidian" writes to: the vaults Obsidian lists, most
 * recently opened first, and any other folder.
 *
 * There is no default: until the reader picks one, the button reads "Choose
 * a vault", and Send to Obsidian asks. With no vault listed, the menu holds
 * only the folder picker. A long list scrolls inside the menu.
 */
import { Check, ChevronDown, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { MENU_ICON, MENU_ITEM, MENU_PANEL, useMenu } from "@/lib/ui/menu";
import { TRACK } from "@/components/ui/Segmented";
import { useVaults } from "@/components/obsidian/ObsidianDialog";
import { pickFolder } from "@/lib/obsidian";

export function VaultSelect({ value, onChange }: { value: string | null; onChange: (path: string) => void }) {
  const all = useVaults(value);
  const { open, setOpen, container, menu, trigger, onKeyDown } = useMenu();
  const chosen = all.find((vault) => vault.path === value);

  const pick = (path: string) => {
    setOpen(false);
    onChange(path);
  };
  const pickOther = () => {
    setOpen(false);
    void pickFolder().then((path) => path && onChange(path));
  };

  return (
    <div ref={container} onKeyDown={onKeyDown} className="relative shrink-0">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Vault"
        title={value ?? undefined}
        onClick={() => setOpen((was) => !was)}
        className={cn(
          // A choice, so it wears the picker's track.
          TRACK,
          "flex max-w-[240px] cursor-interactive items-center gap-sm pt-px pr-ms pl-ms text-label font-medium dark:font-normal",
          "transition-colors duration-(--duration-fast) motion-reduce:transition-none pointer-hover:bg-neutral-200/60",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          chosen ? "text-neutral-950" : "text-neutral-600",
        )}
      >
        <span className="min-w-0 truncate">{chosen?.name ?? "Choose a vault"}</span>
        <ChevronDown
          aria-hidden="true"
          className={cn("size-3.5 shrink-0 text-neutral-500 transition-transform duration-150 motion-reduce:transition-none", open && "rotate-180")}
        />
      </button>

      {open && (
        <div ref={menu} role="listbox" aria-label="Obsidian vaults" className={cn(MENU_PANEL, "w-64")}>
          {all.length > 0 && (
            <div className="max-h-[calc(var(--spacing-row)*6)] overflow-y-auto">
              {all.map((vault) => (
                <button
                  key={vault.path}
                  type="button"
                  role="option"
                  aria-selected={vault.path === value}
                  title={vault.path}
                  onClick={() => pick(vault.path)}
                  className={cn(MENU_ITEM, vault.path === value && "text-foreground")}
                >
                  <Check className={cn(MENU_ICON, "text-current", vault.path !== value && "invisible")} aria-hidden="true" />
                  <span className="min-w-0 truncate">{vault.name}</span>
                </button>
              ))}
            </div>
          )}
          {all.length > 0 && <div aria-hidden="true" className="mx-sm my-xs border-t border-hairline" />}
          {all.length === 0 && <p className="px-sm py-[7px] text-row text-neutral-500">Obsidian lists no vaults</p>}
          <button type="button" role="option" aria-selected={false} onClick={pickOther} className={MENU_ITEM}>
            <FolderOpen className={MENU_ICON} aria-hidden="true" />
            <span>Other folder…</span>
          </button>
        </div>
      )}
    </div>
  );
}

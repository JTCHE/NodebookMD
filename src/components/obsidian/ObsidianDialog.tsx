/**
 * The question a page with pictures asks before it goes to Obsidian: bring
 * the pictures, which writes into a vault folder, or send the text alone.
 * The answer can be kept; Settings changes it back.
 */
import { useEffect, useRef, useState } from "react";
import { Modal, MODAL_LINE, MODAL_TOP } from "@/components/ui/Modal";
import { cn } from "@/lib/utils";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { CHOICE_HANG, ChoiceRow } from "@/components/onboarding/ChoiceRow";
import { SettingRow } from "@/components/onboarding/SettingRow";
import { showToast } from "@/components/ui/toast-notification";
import { invoke } from "@/lib/backend";
import {
  OBSIDIAN_PICTURES,
  pickFolder,
  rememberedVault,
  sendText,
  sendWithPictures,
  vaults,
  type Vault,
} from "@/lib/obsidian";

/** The vaults Obsidian lists, as chips, and a chip to pick any other folder. */
export function VaultPicker({ value, onChange }: { value: string | null; onChange: (path: string) => void }) {
  const [known, setKnown] = useState<Vault[] | null>(null);
  useEffect(() => {
    void vaults().then(setKnown);
  }, []);
  const listed = known ?? [];
  // A folder picked by hand is not in Obsidian's list; it still shows.
  const all = value && !listed.some((vault) => vault.path === value)
    ? [{ path: value, name: value.split(/[\\/]/).filter(Boolean).pop() ?? value }, ...listed]
    : listed;
  return (
    <div className={cn(CHOICE_HANG, "flex flex-wrap gap-sm")}>
      {all.map((vault) => (
        <ChoiceRow key={vault.path} compact label={vault.name} chosen={vault.path === value} onClick={() => onChange(vault.path)} />
      ))}
      <ChoiceRow
        compact
        label="Other folder…"
        onClick={() => void pickFolder().then((path) => path && onChange(path))}
      />
    </div>
  );
}

export function ObsidianDialog({ path, title, markdown, onClose }: { path: string; title: string; markdown: string; onClose: () => void }) {
  const [bring, setBring] = useState(true);
  const [vault, setVault] = useState<string | null>(null);
  const [keep, setKeep] = useState(false);
  const [busy, setBusy] = useState(false);
  const sendButton = useRef<HTMLButtonElement>(null);
  const focused = useRef(false);

  // The vault used last time, else the one Obsidian opened last.
  useEffect(() => {
    void rememberedVault().then(async (path) => setVault(path ?? (await vaults())[0]?.path ?? null));
  }, []);

  // Send takes the focus as soon as it can be pressed, so Enter sends. It
  // waits while the vault is still being read.
  useEffect(() => {
    const button = sendButton.current;
    if (focused.current || !button || button.disabled) return;
    focused.current = true;
    button.focus();
  });

  async function send() {
    setBusy(true);
    try {
      if (keep) await invoke("set_setting", { key: OBSIDIAN_PICTURES, value: bring ? "bring" : "text" });
      if (bring && vault) await sendWithPictures(vault, path, title, markdown);
      else await sendText(path, title, markdown);
      showToast("Sent to Obsidian");
      onClose();
    } catch (reason) {
      showToast(String(reason), "error");
      setBusy(false);
    }
  }

  return (
    <Modal label="Send to Obsidian" onClose={onClose} className="w-full max-w-[440px]">
      <div className={cn("flex flex-col gap-lg px-lg pb-lg", MODAL_TOP)}>
        <header className="flex flex-col gap-2xs">
          <h2 className={cn(MODAL_LINE, "pr-lg text-[17px] font-semibold tracking-[-0.01em] text-neutral-950")}>Send to Obsidian</h2>
          <p className="text-meta text-neutral-500">This page contains media elements. Choose how you want to import them into Obsidian.</p>
        </header>

        <div role="radiogroup" aria-label="Pictures" className={cn(CHOICE_HANG, "flex flex-col gap-sm")}>
          <ChoiceRow
            label="Bring the pictures"
            detail="Writes the note and its pictures into your vault folder"
            chosen={bring}
            onClick={() => setBring(true)}
          />
          <ChoiceRow label="Text only" detail="Opens the note in the vault Obsidian has open" chosen={!bring} onClick={() => setBring(false)} />
        </div>

        {bring && (
          <div className="flex flex-col gap-xs">
            <span className="text-caption text-neutral-500">Vault</span>
            <VaultPicker value={vault} onChange={setVault} />
          </div>
        )}

        <SettingRow label="Remember my choice" detail="Change it in Settings" checked={keep} onChange={setKeep} />

        <div className="flex justify-end">
          <PrimaryButton ref={sendButton} disabled={busy || (bring && !vault)} onClick={() => void send()}>
            {busy ? "Sending…" : "Send"}
          </PrimaryButton>
        </div>
      </div>
    </Modal>
  );
}

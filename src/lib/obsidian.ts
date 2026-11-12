/**
 * Send to Obsidian, two ways.
 *
 * Text alone goes through Obsidian's own `obsidian://new`, with the page on the
 * clipboard: a doc page is longer than a URI handler takes. That needs no
 * folder and no question. A page with pictures can also be written straight
 * into the vault, pictures beside it, because a URI carries text alone. That
 * needs the vault's folder, so it is asked for — and Obsidian's own list of
 * vaults offers it by name first.
 */
import { invoke } from "@/lib/backend";
import { openWeb } from "@/lib/web";
import { APP_NAME } from "@/lib/brand";

/** The vault the pictures were last written into. */
export const OBSIDIAN_VAULT = "obsidian-vault";
/** What a page with pictures does: ask, bring them, or send the text alone. */
export const OBSIDIAN_PICTURES = "obsidian-pictures";
export type PicturesChoice = "ask" | "bring" | "text";

export interface Vault {
  path: string;
  name: string;
}

/** A picture or a clip the note would lose as text. */
export function hasMedia(markdown: string): boolean {
  return /[("]\/?(?:images|videos)\//.test(markdown);
}

export async function picturesChoice(): Promise<PicturesChoice> {
  const value = await invoke<string | null>("get_setting", { key: OBSIDIAN_PICTURES }).catch(() => null);
  return value === "bring" || value === "text" ? value : "ask";
}

export async function rememberedVault(): Promise<string | null> {
  return invoke<string | null>("get_setting", { key: OBSIDIAN_VAULT }).catch(() => null);
}

/** Obsidian's vaults, most recently opened first. */
export function vaults(): Promise<Vault[]> {
  return invoke<Vault[]>("obsidian_vaults").catch(() => []);
}

/** A folder the reader picks by hand, for a vault Obsidian does not list. */
export async function pickFolder(): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({ directory: true, title: "Choose your Obsidian vault" });
  return typeof picked === "string" ? picked : null;
}

/** Where the note goes in the vault, without `.md`: a folder that follows the
    page path, named by the title. `nodes/sop/lattice` → `NodebookMD/nodes/sop/<title>`. */
function noteName(path: string, title: string): string {
  const folders = path.split("/").slice(0, -1);
  const name = title.replace(/[\\/:*?"<>|]/g, " ").trim() || "page";
  return [APP_NAME, ...folders, name].join("/");
}

/** Obsidian shows the file name as the title, so the note drops the H1 that
    follows the frontmatter. */
function noteBody(markdown: string): string {
  return markdown.replace(/^(---\r?\n[\s\S]*?\r?\n---\r?\n+)?# [^\n]*\n+/, "$1");
}

/** The text alone, into the vault Obsidian last had open. */
export async function sendText(path: string, title: string, markdown: string) {
  await navigator.clipboard.writeText(noteBody(markdown));
  await openWeb(`obsidian://new?file=${encodeURIComponent(noteName(path, title))}&clipboard=true`);
}

/** The note and its pictures, written into `vault`, which is then remembered.
    Obsidian then opens the note, as it does for the text alone: `path` finds
    the vault that holds the file. */
export async function sendWithPictures(vault: string, path: string, title: string, markdown: string) {
  const note = await invoke<string>("send_to_obsidian", { vault, name: noteName(path, title), markdown: noteBody(markdown) });
  await invoke("set_setting", { key: OBSIDIAN_VAULT, value: vault });
  await openWeb(`obsidian://open?path=${encodeURIComponent(note)}`);
}

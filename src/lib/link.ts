import { invoke } from "./backend";
import { sideFxUrl } from "./sidefx";

/**
 * What "copy link" writes: Ctrl+L, a heading's link button, and "Copy link
 * address". The search field opens all three forms, so a link copied here
 * comes back to the same page and section.
 */
export const LINK_FORMATS = {
  path: { label: "Path", example: "docs/houdini/nodes/sop/box" },
  app: { label: "App link", example: "nodebookmd://docs/houdini/nodes/sop/box" },
  sidefx: { label: "SideFX website", example: "https://www.sidefx.com/docs/houdini/nodes/sop/box" },
} as const;
export type LinkFormat = keyof typeof LINK_FORMATS;

/** The setting key, in the user database the window and the help pane share. */
export const LINK_FORMAT = "link_format";

/** A path is short, reads the same everywhere, and a web search finds the
    page from it. */
const DEFAULT: LinkFormat = "path";

let chosen: LinkFormat | null = null;

export async function linkFormat(): Promise<LinkFormat> {
  if (chosen) return chosen;
  const stored = await invoke<string | null>("get_setting", { key: LINK_FORMAT }).catch(() => null);
  chosen = stored && stored in LINK_FORMATS ? (stored as LinkFormat) : DEFAULT;
  return chosen;
}

export async function setLinkFormat(format: LinkFormat) {
  await invoke("set_setting", { key: LINK_FORMAT, value: format });
  chosen = format;
}

/** The link to a page, and to a section of it when `hash` names one. */
export async function pageLink(path: string, hash = ""): Promise<string> {
  const section = hash && !hash.startsWith("#") ? `#${hash}` : hash;
  switch (await linkFormat()) {
    case "sidefx":
      return `${sideFxUrl(path)}${section}`;
    case "app":
      return `nodebookmd://docs/houdini/${path}${section}`;
    default:
      return `docs/houdini/${path}${section}`;
  }
}

import { iconUrl } from "./assets";
import { invoke, inTauri } from "./backend";

/** The icon's path in `icons.zip`, `SOP/box.svg`. The help writes it in
    several forms: `PLAYBAR/play_forward.svg`, `TOOLS/handles` with no
    extension, `/icons/BUTTONS/chooser.svg` from the root of the help. Empty
    for a name that names nothing. */
export function iconName(source: string): string {
  if (source.startsWith("http")) return source;
  const name = source.trim().replace(/^\/+/, "").replace(/^icons\//i, "").replace(/(\.svg)+$/i, ".svg");
  if (!name || name === "null" || name === ".svg") return "";
  return /\.[a-z]+$/i.test(name) ? name : `${name}.svg`;
}

/** A help page names an icon by its path in `icons.zip`, e.g. `SOP/box.svg`. */
export function localIconUrl(source: string): string {
  return source.startsWith("http") ? source : iconUrl(iconName(source));
}

/** Icons this window holds, and icons the install does not ship.
    The picture itself is kept, not only its name: WebView2 does not keep a
    `hicon:` response in its cache, and a row mounted again fetched its icon
    again and drew a blank for a few frames. A live image keeps it in memory. */
export const loaded = new Map<string, HTMLImageElement>();
export const missing = new Set<string>();

/** Icons fetched ahead and not yet in. */
const fetching = new Map<string, Promise<void>>();

/** Fetch icons before a row asks for them, so the row draws with its icon.
    Settles when every one is in or known missing. */
export function warmIcons(sources: string[]): Promise<void> {
  return Promise.all(
    sources.map(iconName).map((source) => {
      if (!source || loaded.has(source) || missing.has(source)) return;
      let done = fetching.get(source);
      if (!done) {
        const image = new Image();
        done = new Promise<void>((settle) => {
          image.onload = () => settle(void loaded.set(source, image));
          image.onerror = () => settle(void missing.add(source));
        }).finally(() => fetching.delete(source));
        fetching.set(source, done);
        image.src = localIconUrl(source);
      }
      return done;
    }),
  ).then(() => {});
}

/** The name Houdini itself gives an icon — `SOP_box` for `SOP/box.svg` — the
    one a shelf tool, an HDA or `hou.qt.Icon` asks for. */
export function houdiniIconName(source: string): string {
  return source.replace(/\.svg$/i, "").split("/").filter(Boolean).join("_");
}

/** The SVG text of an icon. The desktop window asks Rust: its picture scheme
    is another origin, which a fetch cannot read. The help pane serves the
    icon on its own origin. */
export async function iconSvg(source: string): Promise<string> {
  if (inTauri) return invoke<string>("icon_svg", { name: source });
  const answer = await fetch(iconUrl(source));
  if (!answer.ok) throw new Error(`No icon at ${source}`);
  return answer.text();
}

/** The longer side of an icon copied or saved as PNG: sharp at any size a
    shelf, a slide or a README puts it. */
const PNG_SIZE = 512;

/** The icon drawn to a PNG. Drawn from the SVG text, not from the `<img>` on
    screen: that one comes from another origin and would taint the canvas. */
export async function iconPng(source: string): Promise<Blob> {
  const svg = await iconSvg(source);
  // A data: URL, not a blob: one: the app's CSP allows data: pictures only.
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();
  // Most help icons give a viewBox and no size, which an <img> draws at a
  // default 150 px whatever the box's shape. The box gives the true shape.
  const box = svg.match(/viewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/);
  const width = box ? Number(box[1]) : image.naturalWidth || 1;
  const height = box ? Number(box[2]) : image.naturalHeight || 1;
  const scale = PNG_SIZE / Math.max(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
  return await new Promise<Blob>((done, fail) =>
    canvas.toBlob((blob) => (blob ? done(blob) : fail(new Error("No PNG"))), "image/png"),
  );
}

/** Asks where to save the icon, as SVG or PNG. Resolves false when the
    reader cancels. The desktop window only: the help pane has no dialog. */
export async function saveIcon(source: string): Promise<boolean> {
  const png = [...new Uint8Array(await (await iconPng(source)).arrayBuffer())];
  return invoke<boolean>("save_icon", { name: source, file: houdiniIconName(source), png });
}

/** Puts the icon on the clipboard as a picture. The PNG is handed over as a
    promise, so the copy keeps the press that asked for it. */
export function copyIconPng(source: string): Promise<void> {
  return navigator.clipboard.write([new ClipboardItem({ "image/png": iconPng(source) })]);
}

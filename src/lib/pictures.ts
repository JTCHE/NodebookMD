/**
 * A page picture as a file the reader takes away: to the clipboard, or
 * dragged out of the window.
 */
import { invoke } from "./backend";
import { showToast } from "@/components/ui/toast-notification";

/** The picture drawn on a canvas, at most `longest` pixels on its long side.
    The picture is served with CORS (`himage`), so the canvas stays readable.
    An SVG with only a viewBox reports no size: it is drawn at 512. */
function drawn(img: HTMLImageElement, longest = Infinity): HTMLCanvasElement {
  const width = img.naturalWidth || 512;
  const height = img.naturalHeight || width;
  const scale = Math.min(1, longest / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Copies the picture as a PNG, and says so. */
export function copyPicture(img: HTMLImageElement): Promise<void> {
  // The promise goes in the item, not its result: the write must start in
  // the press, or the webview refuses it.
  const png = new Promise<Blob>((done, fail) =>
    drawn(img).toBlob((blob) => (blob ? done(blob) : fail(new Error("No PNG"))), "image/png"),
  );
  return navigator.clipboard
    .write([new ClipboardItem({ "image/png": png })])
    .then(() => showToast("Image copied"), () => showToast("Couldn't copy", "error"));
}

/** Starts a drag of the picture's file out of the window (`drag_picture`). */
export function dragPicture(img: HTMLImageElement): Promise<void> {
  const data = drawn(img, 160).toDataURL("image/png").split(",")[1];
  const preview = Array.from(atob(data), (char) => char.charCodeAt(0));
  return invoke<void>("drag_picture", { path: new URL(img.currentSrc || img.src).pathname, preview }).catch(() => {});
}

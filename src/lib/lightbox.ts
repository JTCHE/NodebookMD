import { useSyncExternalStore } from "react";
import type { Ground } from "./ground";

/** One picture the lightbox can show. */
export interface LightboxItem {
  src: string;
  alt: string;
  /** The ground the page chose for it (lib/ground). */
  ground?: Ground;
  /** The help icon it shows, `SOP/box.svg`, for the icon's own menu. */
  icon?: string;
}

export interface LightboxState {
  items: LightboxItem[];
  index: number;
  /** The picture on the page it opened from: the open grows out of it and
      the close shrinks back into it. */
  from: HTMLElement | null;
}

/** The pictures of the open page, in page order. The lightbox walks these
    with the arrow keys, the way a reader expects to walk a page's figures. */
export const PAGE_PICTURES = "article img.markdown-media";

let state: LightboxState | null = null;
const listeners = new Set<() => void>();

function set(next: LightboxState | null) {
  state = next;
  for (const listener of listeners) listener();
}

/** Opens on the page picture `from`, with every picture of the page behind
    it, growing out of that picture. `from` can also be the control that asked
    — the pictures button — which opens on the first picture and grows out of
    the control. */
export function openLightbox(from: HTMLElement) {
  const pictures = [...document.querySelectorAll<HTMLImageElement>(PAGE_PICTURES)];
  if (pictures.length === 0) return;
  const index = Math.max(0, pictures.indexOf(from as HTMLImageElement));
  set({
    items: pictures.map((img) => ({ src: img.currentSrc || img.src, alt: img.alt, ground: img.dataset.ground as Ground | undefined })),
    index,
    from,
  });
}

/** Opens one picture alone, growing out of `from`: the page's icon, which is
    not one of the page's figures. */
export function openPicture(from: HTMLElement, item: LightboxItem) {
  set({ items: [item], index: 0, from });
}

export function closeLightbox() {
  set(null);
}

export function useLightbox(): LightboxState | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}

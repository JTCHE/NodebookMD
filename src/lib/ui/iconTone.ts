/**
 * Marks an icon that is almost all black or almost all white, so that a page
 * of the same tone can flip it. Most icons have both tones and stay as they
 * are. The tone of each icon is read once, from a small copy on a canvas.
 */
const SAMPLE_SIZE = 16;
/** The mean lightness of the drawn pixels, under which an icon is dark. */
const DARK_BELOW = 0.22;
/** The mean lightness over which an icon is light. */
const LIGHT_ABOVE = 0.85;

type Tone = "dark" | "light" | "";
const tones = new Map<string, Promise<Tone>>();

function readTone(source: string): Promise<Tone> {
  const image = new Image();
  // The icon schemes answer with CORS, so the canvas stays readable.
  image.crossOrigin = "anonymous";
  image.src = source;
  return image
    .decode()
    .then(() => {
      const canvas = document.createElement("canvas");
      canvas.width = SAMPLE_SIZE;
      canvas.height = SAMPLE_SIZE;
      const context = canvas.getContext("2d", { willReadFrequently: true })!;
      context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
      const pixels = context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
      let lightness = 0;
      let weight = 0;
      for (let offset = 0; offset < pixels.length; offset += 4) {
        const alpha = pixels[offset + 3] / 255;
        lightness += alpha * (0.2126 * pixels[offset] + 0.7152 * pixels[offset + 1] + 0.0722 * pixels[offset + 2]) / 255;
        weight += alpha;
      }
      if (weight === 0) return "";
      const mean = lightness / weight;
      return mean < DARK_BELOW ? "dark" : mean > LIGHT_ABOVE ? "light" : "";
    })
    .catch((): Tone => "");
}

const isIcon = (image: HTMLImageElement) => /hicon|\/icon\//.test(image.src);

function mark(image: HTMLImageElement) {
  const source = image.src;
  let tone = tones.get(source);
  if (!tone) {
    tone = readTone(source);
    tones.set(source, tone);
  }
  void tone.then((value) => {
    // The element can hold another icon by now.
    if (image.src !== source) return;
    if (value) image.dataset.tone = value;
    else delete image.dataset.tone;
  });
}

/** Called once, from `main.tsx`. A load event does not bubble, so it is caught on the way down. */
export function startIconTone() {
  document.addEventListener(
    "load",
    (event) => {
      if (event.target instanceof HTMLImageElement && isIcon(event.target)) mark(event.target);
    },
    true,
  );
}

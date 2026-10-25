import { useEffect, useState } from "react";
import { Icons } from "@/lib/ui/icons";

/** Thumbnails already asked for, so a page read again asks Vimeo nothing. */
const thumbnails = new Map<string, Promise<string | null>>();

/** The clip's still, from Vimeo's oEmbed answer. Null where there is none. */
function thumbnail(clip: string): Promise<string | null> {
  let answer = thumbnails.get(clip);
  if (!answer) {
    const url = `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(`https://vimeo.com/${clip}`)}&width=1280`;
    answer = fetch(url)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { thumbnail_url?: string } | null) => data?.thumbnail_url ?? null)
      .catch(() => null);
    thumbnails.set(clip, answer);
  }
  return answer;
}

/** A Vimeo clip the help page embeds — `vimeo` in the parser's `markdown.rs`.
    The page shows the clip's still, which Vimeo's oEmbed names. The player
    itself loads only when the reader presses play. Offline, or where Vimeo
    has no still, the frame stays plain. `dnt=1` asks Vimeo not to track the
    viewer. */
export function Vimeo({ id, title }: { id: string; title?: string }) {
  const [playing, setPlaying] = useState(false);
  const [still, setStill] = useState<string | null>(null);
  const clip = id.replace(/\D/g, "");

  useEffect(() => {
    if (!clip) return;
    let live = true;
    void thumbnail(clip).then((url) => live && setStill(url));
    return () => {
      live = false;
    };
  }, [clip]);

  if (!clip) return null;
  const label = title ? `${title} — Vimeo` : "Play on Vimeo";
  return (
    <div className="markdown-media relative my-4 bg-muted" style={{ aspectRatio: "16 / 9" }}>
      {playing ? (
        <iframe
          src={`https://player.vimeo.com/video/${clip}?autoplay=1&dnt=1`}
          title={title || "Vimeo video"}
          allow="autoplay; fullscreen; picture-in-picture"
          allowFullScreen
          className="absolute inset-0 size-full border-0"
        />
      ) : (
        <button
          type="button"
          onClick={() => setPlaying(true)}
          aria-label={label}
          className={
            "group absolute inset-0 flex cursor-interactive flex-col items-center justify-center gap-2 " +
            "text-muted-foreground transition-colors duration-(--duration-fast) motion-reduce:transition-none " +
            "pointer-hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          }
        >
          {still ? (
            <>
              {/* `m-0!`: the article's margin for pictures, later in the sheet, pushed it down. */}
              <img src={still} alt="" className="absolute inset-0 m-0! size-full object-cover" />
              {/* The mark sits on a dark disc: a still can be any colour. */}
              <span className="relative flex size-14 items-center justify-center rounded-full bg-black/60 text-white transition-transform duration-(--duration-fast) group-hover:scale-105 motion-reduce:transition-none">
                <Icons.play className="ml-0.5 size-6" />
              </span>
            </>
          ) : (
            <>
              <Icons.play className="size-8" />
              <span className="text-sm">{label}</span>
            </>
          )}
        </button>
      )}
    </div>
  );
}

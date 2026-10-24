import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type SVGProps,
} from "react";
import { ProgressiveBlur } from "@jtche/progressive-blur";

function icon(path: string) {
  return function PlayerIcon(props: SVGProps<SVGSVGElement>) {
    return (
      <svg {...props} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d={path}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  };
}

/** Play and pause are filled: the two states of the main button read at a
    glance, and the outlined icons around them stay secondary. The round
    stroke softens the corners. */
function solid(path: string) {
  return function PlayerIcon(props: SVGProps<SVGSVGElement>) {
    return (
      <svg {...props} viewBox="0 0 24 24" aria-hidden="true">
        <path d={path} fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    );
  };
}

const PlayIcon = solid("M16.6582 9.28638C18.098 10.1862 18.8178 10.6361 19.0647 11.2122C19.2803 11.7152 19.2803 12.2847 19.0647 12.7878C18.8178 13.3638 18.098 13.8137 16.6582 14.7136L9.896 18.94C8.29805 19.9387 7.49907 20.4381 6.83973 20.385C6.26501 20.3388 5.73818 20.0469 5.3944 19.584C5 19.053 5 18.1108 5 16.2264V7.77357C5 5.88919 5 4.94701 5.3944 4.41598C5.73818 3.9531 6.26501 3.66111 6.83973 3.6149C7.49907 3.5619 8.29805 4.06126 9.896 5.05998L16.6582 9.28638Z");
const PauseIcon = solid("M7 4.5h3v15H7zM14 4.5h3v15h-3z");
const VolumeHighIcon = icon("M16.0004 9.00009C16.6281 9.83575 17 10.8745 17 12.0001C17 13.1257 16.6281 14.1644 16.0004 15.0001M18 5.29177C19.8412 6.93973 21 9.33459 21 12.0001C21 14.6656 19.8412 17.0604 18 18.7084M4.6 9.00009H5.5012C6.05213 9.00009 6.32759 9.00009 6.58285 8.93141C6.80903 8.87056 7.02275 8.77046 7.21429 8.63566C7.43047 8.48353 7.60681 8.27191 7.95951 7.84868L10.5854 4.69758C11.0211 4.17476 11.2389 3.91335 11.4292 3.88614C11.594 3.86258 11.7597 3.92258 11.8712 4.04617C12 4.18889 12 4.52917 12 5.20973V18.7904C12 19.471 12 19.8113 11.8712 19.954C11.7597 20.0776 11.594 20.1376 11.4292 20.114C11.239 20.0868 11.0211 19.8254 10.5854 19.3026L7.95951 16.1515C7.60681 15.7283 7.43047 15.5166 7.21429 15.3645C7.02275 15.2297 6.80903 15.1296 6.58285 15.0688C6.32759 15.0001 6.05213 15.0001 5.5012 15.0001H4.6C4.03995 15.0001 3.75992 15.0001 3.54601 14.8911C3.35785 14.7952 3.20487 14.6422 3.10899 14.4541C3 14.2402 3 13.9601 3 13.4001V10.6001C3 10.04 3 9.76001 3.10899 9.54609C3.20487 9.35793 3.35785 9.20495 3.54601 9.10908C3.75992 9.00009 4.03995 9.00009 4.6 9.00009Z");
const VolumeLowIcon = icon("M18 9.00009C18.6277 9.83575 18.9996 10.8745 18.9996 12.0001C18.9996 13.1257 18.6277 14.1644 18 15.0001M6.6 9.00009H7.5012C8.05213 9.00009 8.32759 9.00009 8.58285 8.93141C8.80903 8.87056 9.02275 8.77046 9.21429 8.63566C9.43047 8.48353 9.60681 8.27191 9.95951 7.84868L12.5854 4.69758C13.0211 4.17476 13.2389 3.91335 13.4292 3.88614C13.594 3.86258 13.7597 3.92258 13.8712 4.04617C14 4.18889 14 4.52917 14 5.20973V18.7904C14 19.471 14 19.8113 13.8712 19.954C13.7597 20.0776 13.594 20.1376 13.4292 20.114C13.239 20.0868 13.0211 19.8254 12.5854 19.3026L9.95951 16.1515C9.60681 15.7283 9.43047 15.5166 9.21429 15.3645C9.02275 15.2297 8.80903 15.1296 8.58285 15.0688C8.32759 15.0001 8.05213 15.0001 7.5012 15.0001H6.6C6.03995 15.0001 5.75992 15.0001 5.54601 14.8911C5.35785 14.7952 5.20487 14.6422 5.10899 14.4541C5 14.2402 5 13.9601 5 13.4001V10.6001C5 10.04 5 9.76001 5.10899 9.54609C5.20487 9.35793 5.35785 9.20495 5.54601 9.10908C5.75992 9.00009 6.03995 9.00009 6.6 9.00009Z");
const MutedIcon = icon("M16 9.50009L21 14.5001M21 9.50009L16 14.5001M4.6 9.00009H5.5012C6.05213 9.00009 6.32759 9.00009 6.58285 8.93141C6.80903 8.87056 7.02275 8.77046 7.21429 8.63566C7.43047 8.48353 7.60681 8.27191 7.95951 7.84868L10.5854 4.69758C11.0211 4.17476 11.2389 3.91335 11.4292 3.88614C11.594 3.86258 11.7597 3.92258 11.8712 4.04617C12 4.18889 12 4.52917 12 5.20973V18.7904C12 19.471 12 19.8113 11.8712 19.954C11.7597 20.0776 11.594 20.1376 11.4292 20.114C11.239 20.0868 11.0211 19.8254 10.5854 19.3026L7.95951 16.1515C7.60681 15.7283 7.43047 15.5166 7.21429 15.3645C7.02275 15.2297 6.80903 15.1296 6.58285 15.0688C6.32759 15.0001 6.05213 15.0001 5.5012 15.0001H4.6C4.03995 15.0001 3.75992 15.0001 3.54601 14.8911C3.35785 14.7952 3.20487 14.6422 3.10899 14.4541C3 14.2402 3 13.9601 3 13.4001V10.6001C3 10.04 3 9.76001 3.10899 9.54609C3.20487 9.35793 3.35785 9.20495 3.54601 9.10908C3.75992 9.00009 4.03995 9.00009 4.6 9.00009Z");
const ExpandIcon = icon("M14 10L21 3M21 3H16.5M21 3V7.5M10 14L3 21M3 21H7.5M3 21L3 16.5");
const CompressIcon = icon("M14 10L21 3M14 10H18.5M14 10V5.5M10 14L3 21M10 14H5.5M10 14L10 18.5");

/** Controls stay up this long after the pointer stops, while the clip plays. */
const IDLE_MS = 2000;
const SEEK_SECONDS = 5;
const VOLUME_STEP = 0.05;

/** m:ss, or h:mm:ss from one hour. */
function clock(seconds: number) {
  const s = String(Math.floor(seconds % 60)).padStart(2, "0");
  const m = Math.floor(seconds / 60) % 60;
  const h = Math.floor(seconds / 3600);
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** The tooltip is the button's own `aria-label`, drawn by CSS. */
function ControlButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="video-button" aria-label={label} onClick={onClick}>
      {children}
    </button>
  );
}

export interface DocVideoClientProps {
  src: string;
  title?: string;
}

/**
 * The box takes 16/9 until the clip reports its own size, then corrects. The
 * clip is a file on this machine, so metadata arrives in the same frame.
 *
 * Only one video plays at a time: starting one pauses every other on the page.
 */
export default function DocVideoClient({ src, title }: DocVideoClientProps) {
  const [ratio, setRatio] = useState("16 / 9");
  const [paused, setPaused] = useState(true);
  const [idle, setIdle] = useState(false);
  const [loading, setLoading] = useState(true);
  const [time, setTime] = useState(clock(0));
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [hover, setHover] = useState<{ x: number; label: string } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const seekRef = useRef<HTMLInputElement>(null);
  const idleTimer = useRef(0);

  // The seek bar is written directly, not through state: it moves every frame
  // while the clip plays, and a render per frame is waste.
  const sync = useCallback(() => {
    const video = videoRef.current;
    const seek = seekRef.current;
    if (!video || !seek) return;
    seek.value = String(video.currentTime);
    seek.style.setProperty("--fill", `${(video.currentTime / (video.duration || 1)) * 100}%`);
    setTime(clock(video.currentTime));
  }, []);

  // Stop when the controls are hidden: nobody can see the bar move.
  useEffect(() => {
    if (paused || idle) return;
    let frame = 0;
    const tick = () => {
      sync();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [paused, idle, sync]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === boxRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      clearTimeout(idleTimer.current);
    };
  }, []);

  // A clip the reader scrolled past keeps playing and keeps making sound.
  // Pause it when it leaves the viewport; a reader who scrolls back presses
  // play again, same as one who paused it on purpose.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting && !videoRef.current?.paused) videoRef.current?.pause();
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  const wake = () => {
    setIdle(false);
    clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setIdle(true), IDLE_MS);
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (video) video.muted = !video.muted;
  };

  const setLevel = (level: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = Math.min(1, Math.max(0, level));
    video.muted = video.volume === 0;
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else boxRef.current?.requestFullscreen().catch(() => {});
  };

  const seekBy = (seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.min(video.duration || 0, Math.max(0, video.currentTime + seconds));
    sync();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    // A focused slider moves itself, and a focused button presses itself.
    if (target instanceof HTMLInputElement && event.key.startsWith("Arrow")) return;
    if (target instanceof HTMLButtonElement && (event.key === " " || event.key === "Enter")) return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const action = {
      " ": togglePlay,
      k: togglePlay,
      m: toggleMute,
      f: toggleFullscreen,
      j: () => seekBy(-SEEK_SECONDS),
      l: () => seekBy(SEEK_SECONDS),
      ArrowLeft: () => seekBy(-SEEK_SECONDS),
      ArrowRight: () => seekBy(SEEK_SECONDS),
      ArrowUp: () => setLevel((videoRef.current?.volume ?? 1) + VOLUME_STEP),
      ArrowDown: () => setLevel((videoRef.current?.volume ?? 1) - VOLUME_STEP),
    }[key];
    if (!action) return;
    // Also keeps the letter out of type-to-search, which skips a handled key.
    event.preventDefault();
    action();
    wake();
  };

  const level = muted ? 0 : volume;
  const VolumeIcon = level === 0 ? MutedIcon : level < 0.5 ? VolumeLowIcon : VolumeHighIcon;

  return (
    <div
      ref={boxRef}
      role="group"
      aria-label={title || "Documentation video"}
      tabIndex={0}
      className="markdown-media markdown-video not-prose relative isolate my-4 bg-muted"
      style={{ aspectRatio: ratio }}
      data-idle={(idle && !paused) || undefined}
      onPointerMove={wake}
      onKeyDown={onKeyDown}
    >
      <video
        ref={videoRef}
        // A start time of a frame, so WebKit draws the first frame as the
        // still. With only the metadata loaded it leaves the box empty.
        src={`${src}#t=0.001`}
        preload="metadata"
        playsInline
        className="absolute inset-0 size-full cursor-interactive"
        onClick={togglePlay}
        onDoubleClick={toggleFullscreen}
        onLoadedMetadata={(event) => {
          const video = event.currentTarget;
          if (video.videoWidth && video.videoHeight) setRatio(`${video.videoWidth} / ${video.videoHeight}`);
          setDuration(video.duration);
          setLoading(false);
          sync();
        }}
        onDurationChange={(event) => setDuration(event.currentTarget.duration)}
        onTimeUpdate={sync}
        onWaiting={() => setLoading(true)}
        onPlaying={() => setLoading(false)}
        onCanPlay={() => setLoading(false)}
        onError={() => setLoading(false)}
        onVolumeChange={(event) => {
          setMuted(event.currentTarget.muted);
          setVolume(event.currentTarget.volume);
        }}
        onPlay={() => {
          setPaused(false);
          wake();
          // The clip elements are the register, so nothing has to be kept in
          // step with them.
          for (const other of document.querySelectorAll("video")) {
            if (other !== videoRef.current) other.pause();
          }
        }}
        onPause={() => {
          setPaused(true);
          sync();
        }}
      />

      {loading && <span className="video-spinner animate-spin motion-reduce:animate-none" aria-hidden="true" />}

      <ProgressiveBlur side="bottom" strength={12} steps={6} className="video-blur" />

      <div className="video-controls">
        <div
          className="video-seek"
          onPointerMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
            setHover({ x: event.clientX - rect.left, label: clock(fraction * duration) });
          }}
          onPointerLeave={() => setHover(null)}
        >
          {hover && (
            <span className="video-seek-preview" style={{ left: `clamp(1rem, ${hover.x}px, calc(100% - 1rem))` }}>
              {hover.label}
            </span>
          )}
          <input
            ref={seekRef}
            type="range"
            min={0}
            max={duration || 0}
            step="any"
            defaultValue={0}
            aria-label="Seek"
            aria-valuetext={`${time} of ${clock(duration)}`}
            onChange={(event) => {
              const video = videoRef.current;
              if (video) video.currentTime = Number(event.currentTarget.value);
              sync();
            }}
          />
        </div>

        <div className="video-bar">
          <ControlButton label={paused ? "Play" : "Pause"} onClick={togglePlay}>
            {paused ? <PlayIcon className="translate-x-px" /> : <PauseIcon />}
          </ControlButton>
          <div className="video-volume">
            <ControlButton label={muted ? "Unmute" : "Mute"} onClick={toggleMute}>
              <VolumeIcon />
            </ControlButton>
            <input
              type="range"
              min={0}
              max={1}
              step={VOLUME_STEP}
              value={level}
              aria-label="Volume"
              style={{ "--fill": `${level * 100}%` } as CSSProperties}
              onChange={(event) => setLevel(Number(event.currentTarget.value))}
            />
          </div>
          <span className="video-time">
            {time}
            <span className="video-time-divider">/</span>
            {clock(duration)}
          </span>
          <span className="flex-1" />
          <ControlButton label={fullscreen ? "Exit full screen" : "Enter full screen"} onClick={toggleFullscreen}>
            {fullscreen ? <CompressIcon /> : <ExpandIcon />}
          </ControlButton>
        </div>
      </div>
    </div>
  );
}

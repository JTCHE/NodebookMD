/**
 * Every glyph the app chrome draws, in one place.
 *
 * The shell never imports an icon package directly. It asks for a ROLE —
 * `Icons.bookmark`, `Icons.back` — so swapping the drawing behind a role is an
 * edit to this file and to nothing else. A role that lucide already draws well
 * is an alias; a role lucide has no honest match for (the Windows caption
 * buttons, which must be the OS shapes and not a rounded-cap approximation) is
 * drawn here.
 *
 * Sizes are NOT set here. A role is used at 10px in a tree row and at 15px in a
 * list row, so the caller states the size and this file states the shape.
 */
import {
  AppWindow,
  Plus,
  House,
  ArrowLeft,
  ArrowRight,
  Bookmark,
  BookOpen,
  Bug,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  ChevronUp,
  Clock,
  Code2,
  FileText,
  Folder,
  Library,
  Workflow,
  PanelLeft,
  Pin,
  Play,
  Search,
  Settings,
  X,
  Moon,
  Monitor,
  Sun,
  type LucideIcon,
} from "lucide-react";

export type IconComponent = LucideIcon | ((props: { className?: string }) => React.ReactElement);

/**
 * The Windows 11 caption buttons.
 *
 * Drawn rather than aliased: the OS shapes have square caps on a 10px box, and
 * lucide's round caps read as a different application's buttons sitting in the
 * title bar. The line weight comes from the stylesheet, as for every icon, and
 * `crispEdges` puts the straight lines on whole device pixels. The box does not
 * clip: a line on its edge would be cut at a part of a device pixel, and blur.
 */
function CaptionMinimize({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 10 10" className={className} fill="none" stroke="currentColor" shapeRendering="crispEdges" overflow="visible" aria-hidden="true">
      <path d="M0 5h10" />
    </svg>
  );
}

function CaptionMaximize({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 10 10" className={className} fill="none" stroke="currentColor" shapeRendering="crispEdges" overflow="visible" aria-hidden="true">
      <rect x="0.5" y="0.5" width="9" height="9" />
    </svg>
  );
}

/** Two offset squares, the shape Windows uses once a window is maximized. */
function CaptionRestore({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 10 10" className={className} fill="none" stroke="currentColor" shapeRendering="crispEdges" overflow="visible" aria-hidden="true">
      <path d="M2.5 2.5V0.5h7v7h-2" />
      <rect x="0.5" y="2.5" width="7" height="7" />
    </svg>
  );
}

function CaptionClose({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 10 10" className={className} fill="none" stroke="currentColor" aria-hidden="true">
      <path d="M0 0l10 10M10 0L0 10" />
    </svg>
  );
}

/** The Obsidian mark, so the app's way out to Obsidian reads as Obsidian. */
function ObsidianIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M19.355 18.538a68.967 68.959 0 0 0 1.858-2.954.81.81 0 0 0-.062-.9c-.516-.685-1.504-2.075-2.042-3.362-.553-1.321-.636-3.375-.64-4.377a1.707 1.707 0 0 0-.358-1.05l-3.198-4.064a3.744 3.744 0 0 1-.076.543c-.106.503-.307 1.004-.536 1.5-.134.29-.29.6-.446.914l-.31.626c-.516 1.068-.997 2.227-1.132 3.59-.124 1.26.046 2.73.815 4.481.128.011.257.025.386.044a6.363 6.363 0 0 1 3.326 1.505c.916.79 1.744 1.922 2.415 3.5zM8.199 22.569c.073.012.146.02.22.02.78.024 2.095.092 3.16.29.87.16 2.593.64 4.01 1.055 1.083.316 2.198-.548 2.355-1.664.114-.814.33-1.735.725-2.58l-.01.005c-.67-1.87-1.522-3.078-2.416-3.849a5.295 5.295 0 0 0-2.778-1.257c-1.54-.216-2.952.19-3.84.45.532 2.218.368 4.829-1.425 7.531zM5.533 9.938c-.023.1-.056.197-.098.29L2.82 16.059a1.602 1.602 0 0 0 .313 1.772l4.116 4.24c2.103-3.101 1.796-6.02.836-8.3-.728-1.73-1.832-3.081-2.55-3.831zM9.32 14.01c.615-.183 1.606-.465 2.745-.534-.683-1.725-.848-3.233-.716-4.577.154-1.552.7-2.847 1.235-3.95.113-.235.223-.454.328-.664.149-.297.288-.577.419-.86.217-.47.379-.885.46-1.27.08-.38.08-.72-.014-1.043-.095-.325-.297-.675-.68-1.06a1.6 1.6 0 0 0-1.475.36l-4.95 4.452a1.602 1.602 0 0 0-.513.952l-.427 2.83c.672.59 2.328 2.316 3.335 4.711.09.21.175.43.253.653z" />
    </svg>
  );
}

export const Icons = {
  /* App chrome */
  sidebarToggle: PanelLeft,
  back: ArrowLeft,
  forward: ArrowRight,
  settings: Settings,
  themeLight: Sun,
  themeDark: Moon,
  themeSystem: Monitor,
  bugReport: Bug,
  search: Search,
  home: House,
  newWindow: AppWindow,
  newTab: Plus,

  /* Window caption */
  captionMinimize: CaptionMinimize,
  captionMaximize: CaptionMaximize,
  captionRestore: CaptionRestore,
  captionClose: CaptionClose,

  /* Disclosure */
  expanded: ChevronDown,
  collapsed: ChevronRight,
  stepBack: ChevronLeft,
  stepForward: ChevronRight,
  /** The find bar: the match above, the match below. */
  findPrevious: ChevronUp,
  findNext: ChevronDown,

  /* Window */
  pin: Pin,
  versionPicker: ChevronsUpDown,

  /* Content */
  bookmark: Bookmark,
  obsidian: ObsidianIcon,
  chosen: Check,
  dismiss: X,
  recent: Clock,
  /** A page the help holds no icon for. */
  page: FileText,
  /** A section the help holds no icon for. A section holds pages, so the page
      glyph is the wrong shape: it says the row IS a page. */
  section: Folder,
  /** A clip that has not loaded yet. */
  play: Play,

  /* The four groups the sidebar tree opens with. Keyed by the group id in
     `lib/landing/tree.ts`, so a new group there asks for a mark here. */
  groupNodes: Workflow,
  groupLanguages: Code2,
  groupLearn: BookOpen,
  groupReference: Library,
} satisfies Record<string, IconComponent>;

export type IconRole = keyof typeof Icons;

/** The mark for a top-level tree group, by its id. */
export function groupIcon(id: string): IconComponent | null {
  const role = `group${id.charAt(0).toUpperCase()}${id.slice(1)}` as IconRole;
  return role in Icons ? Icons[role] : null;
}

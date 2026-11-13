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
  ChevronsDownUp,
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
  // Drawn as a stroke, like the lucide icons beside it: the gem's outline and
  // the curved crease that splits it.
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 2l7.5 1.5 4.5 9-4 9.5-9-2.5-3.5-6.5 2-7z" />
      <path d="M8 2c-.5 4 .5 7.5 3 10s4 6 5 10" />
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
  /** Open or close every method on a class page. */
  expandAll: ChevronsUpDown,
  collapseAll: ChevronsDownUp,

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

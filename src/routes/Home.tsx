import { SearchField } from "@/components/root/search-field/SearchField";
import { LibraryPanel } from "@/components/root/LibraryPanel";
import { UpdatedPill } from "@/components/root/UpdatedPill";
import { DISPLAY_TITLE } from "@/lib/ui/type";
import { APP_NAME } from "@/lib/brand";

/**
 * What the window opens on.
 *
 * The app is a tool on a machine where the reader already chose it, so the
 * page does not sell anything: it puts the caret
 * in the search field, and lists the pages the reader was last in. Two
 * things, on one axis, in the middle of the window.
 *
 * The name of the app is NOT here. The title bar says it, on every route.
 */
export default function Home() {
  return (
    <main className="relative flex min-h-0 flex-1 flex-col overflow-hidden @container">
      <UpdatedPill />

      <div className="relative flex min-h-0 flex-1 flex-col justify-center px-lg py-lg">
<div className="mx-auto flex min-h-0 w-full max-w-hero flex-col gap-xl">
          <div className="flex shrink-0 flex-col gap-lg">
            <header className="flex flex-col gap-xs">
              <h1 className={DISPLAY_TITLE}>
                Welcome to {APP_NAME}
              </h1>
            </header>

            <SearchField />
          </div>

          {/* The list keeps a box of its own size, so the greeting and the
              field sit on the same axis whatever is in the list and whichever
              tab is open. */}
          <LibraryPanel />
        </div>
      </div>
    </main>
  );
}

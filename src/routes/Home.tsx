import { SearchField } from "@/components/root/search-field/SearchField";
import { LibraryPanel } from "@/components/root/LibraryPanel";
import { UpdatedPill } from "@/components/root/UpdatedPill";
import { pagesLabel, useBuild, useIndex } from "@/lib/install";
import { DISPLAY_TITLE } from "@/lib/ui/type";
import { APP_NAME } from "@/lib/brand";

/**
 * What the window opens on.
 *
 * The app is a tool on a machine where the reader already chose it, so the
 * page does not sell anything: it names the build it reads, puts the caret
 * in the search field, and lists the pages the reader was last in. Three
 * things, on one axis, in the middle of the window.
 *
 * The name of the app is NOT here. The title bar says it, on every route.
 */
export default function Home() {
  const { version, pageCount } = useBuild();
  const { status } = useIndex();

  return (
    <main className="relative flex min-h-0 flex-1 flex-col overflow-hidden @container">
      <UpdatedPill />

      <div className="relative flex min-h-0 flex-1 flex-col justify-center px-lg py-lg">
        {/* The column fills the window up to a cap, and the list takes what
            the greeting and the field leave. It runs down and fades out near
            the keys, so the page has no empty floor under a short list box. */}
        <div className="mx-auto flex max-h-[600px] min-h-0 w-full max-w-hero flex-1 flex-col gap-xl">
          <div className="flex shrink-0 flex-col gap-lg">
            <header className="flex flex-col gap-xs">
              <h1 className={DISPLAY_TITLE}>
                Welcome to {APP_NAME}.
              </h1>
              <p className="flex items-center flex-wrap gap-x-sm text-[16px] leading-6 tracking-[-0.012em] text-neutral-500">
                {version === null ? (
                  "Reading the Houdini install…"
                ) : version ? (
                  <>
                    <span>Houdini {version}</span>
                    <span className="before:content-['·'] before:mr-sm @max-xs:before:content-none @max-xs:before:mr-0">
                      {pageCount === null ? "counting pages…" : pagesLabel(pageCount, status)}
                    </span>
                  </>
                ) : (
                  "No Houdini install found on this machine."
                )}
              </p>
            </header>

            <SearchField />
          </div>

          <LibraryPanel className="flex-1" />
        </div>
      </div>
    </main>
  );
}

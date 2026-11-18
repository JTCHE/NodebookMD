import { useNavigate } from "react-router";
import { useTrail } from "@/lib/nav";
import DocLink from "./DocLink";

/**
 * Drawn by the reading view when the install holds no such page. It sits on
 * the page's own text axis, in the page's own type, so it reads as a page
 * and not as an error box.
 *
 * A reader who followed a link here wants the page they came from, so the way
 * out is "back" while there is a page behind this one, and "home" only when
 * this is the first page of the trail. A letter typed anywhere opens search.
 */
export default function NotFoundPage({ path }: { path: string }) {
  const navigate = useNavigate();
  const { canGoBack } = useTrail();
  const action = "-mx-2 rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors pointer-hover:bg-muted pointer-hover:text-foreground";
  return (
    <main className="mx-auto flex w-full max-w-page flex-1 flex-col justify-center px-page-x py-10">
      <p className="m-0 font-mono text-xs text-muted-foreground">{path}</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-balance">This page is not in the selected Houdini build</h1>
      <p className="mt-3 max-w-prose text-sm text-muted-foreground text-pretty">
        Another build may have it, or the page may have a new name. Start to type to search for it.
      </p>
      <div className="mt-6 flex">
        {canGoBack ? (
          <button type="button" onClick={() => void navigate(-1)} className={`cursor-interactive ${action}`}>
            ← Go back
          </button>
        ) : (
          <DocLink href="/" className={action}>
            Go home
          </DocLink>
        )}
      </div>
    </main>
  );
}

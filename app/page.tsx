import { ArrowUpRight } from "lucide-react";
import { ViewRecorder } from "@/components/ViewRecorder";
import { AppIcon } from "@/components/landing/AppIcon";
import { Showcase } from "@/components/landing/showcase/Showcase";
import { AsciiBackground } from "@/components/root/AsciiBackground";
import { DownloadKey, MacInstall } from "@/components/ui/download-key";
import { MCP_URL, REPO_URL, SITE_NAME } from "@/lib/brand";
import { SPRING_CSS } from "@/lib/landing/spring";

export const revalidate = false;

/** One screen, no scroll: what the app is, how to get it, and the app itself.
    The header sizes by the screen's height, so a short screen keeps its room
    for the app. */
export default function Home() {
  return (
    <main
      data-landing
      className="relative flex min-h-dvh flex-col overflow-hidden">
      <ViewRecorder path="/" />

      <AsciiBackground className="enter-backdrop" />
      <style>{SPRING_CSS}</style>

      <div className="relative mx-auto flex w-full max-w-[84rem] flex-1 flex-col items-center gap-lg px-page-x py-2xl">
        <header className="flex shrink-0 flex-col items-center text-center">
          {/* The icon above the name, as an app's own page shows it: the name
              is a word, and the icon the thing a reader finds in the dock. */}
          <div
            style={{ "--enter": 0 } as React.CSSProperties}
            className="enter"
          >
            <AppIcon className="size-3xl max-sm:size-2xl" />
          </div>
          <h1
            style={{ "--enter": 1 } as React.CSSProperties}
            className="enter mt-sm text-[clamp(34px,6vh,50px)] leading-none max-sm:text-[36px] font-semibold tracking-[-0.04em] text-foreground"
          >
            {SITE_NAME}
          </h1>
          <p
            style={{ "--enter": 2 } as React.CSSProperties}
            className="enter mt-sm text-[clamp(19px,3vh,27px)] leading-tight max-sm:text-[19px] font-semibold tracking-[-0.025em] text-foreground"
          >
            The Houdini docs, instant and offline.
          </p>
          <p
            style={{ "--enter": 3 } as React.CSSProperties}
            className="enter mt-xs max-w-[40rem] text-[clamp(15px,2vh,17px)] leading-normal max-sm:text-[14px] text-muted-foreground"
          >
            Navigate, search, and explore at blazing speeds using this free,{" "}
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="text-foreground underline decoration-hairline underline-offset-4 transition-colors hover:decoration-foreground"
            >
              open-source
            </a>{" "}
            app.
          </p>
          <div
            style={{ "--enter": 4 } as React.CSSProperties}
            className="enter mt-md flex flex-wrap items-center justify-center gap-x-md gap-y-sm"
          >
            <DownloadKey />
            <a
              href={MCP_URL}
              target="_blank"
              rel="noreferrer"
              className="group flex items-center gap-1 text-label font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Connect your agent
              <ArrowUpRight className="size-3.5 transition-transform group-hover:translate-x-px group-hover:-translate-y-px" />
            </a>
          </div>
          <MacInstall style={{ "--enter": 4 } as React.CSSProperties} className="enter mt-sm" />
        </header>

        <Showcase />
      </div>

      <footer
        style={{ "--enter": 7 } as React.CSSProperties}
        className="enter relative shrink-0 px-page-x pb-sm text-center text-caption text-muted-foreground"
      >
        {/* The pages in the frame are ours, not SideFX's: say so under it. The old
            name is here, once and beside the disclaimer, so a visitor from
            houdinimd.com knows the page. Never in the title: SideFX asked for
            the name to go. */}
        <p className="max-sm:hidden">
          This app is a mockup of the product. Sample pages have been re-written specifically for this site.
        </p>
        <p className="max-sm:hidden">
          {`${SITE_NAME}, formerly HoudiniMD, is an unofficial, independent project, and isn't affiliated with or endorsed by SideFX.`}
        </p>
        <p className="max-sm:hidden">
          For AI agents:{" "}
          <a href="/llms.txt" className="underline decoration-hairline underline-offset-4 transition-colors hover:text-foreground">
            llms.txt
          </a>
        </p>
        {/* A phone has room for the gist only. */}
        <p className="sm:hidden">Formerly HoudiniMD. A mockup with sample pages. Not affiliated with SideFX.</p>
      </footer>
    </main>
  );
}

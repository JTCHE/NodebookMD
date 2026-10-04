import type { Metadata } from "next";
import { DocTakedown } from "@/components/docs/DocTakedown";
import { DocsPageContent } from "@/components/docs/DocsPageContent";
import { SITE_NAME } from "@/lib/brand";
import { CRUMBS, SLUG, TITLE } from "@/lib/notice";
import { GONE, sidefxUrl } from "@/lib/takedown";

export const metadata: Metadata = {
  title: `${TITLE} | ${SITE_NAME}`,
  description: GONE,
  robots: { index: false },
};

/**
 * The notice every doc address gets. The Worker fills in the placeholders
 * (lib/notice.ts) and never serves this address itself.
 */
export default function DocsNoticePage() {
  return (
    <DocsPageContent
      sourceUrl={sidefxUrl(SLUG)}
      breadcrumbs={<span dangerouslySetInnerHTML={{ __html: CRUMBS }} />}
    >
      <DocTakedown
        slug={SLUG}
        name={TITLE}
        sourceUrl={sidefxUrl(SLUG)}
      />
    </DocsPageContent>
  );
}

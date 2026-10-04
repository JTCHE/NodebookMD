import { SITE_NAME } from "@/lib/brand";
import { SITE_URL } from "@/lib/site";
import { THEME_HEAD_SCRIPT } from "@/lib/theme";
import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

export const viewport: Viewport = {
  maximumScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "oklch(1 0 0)" },
    { media: "(prefers-color-scheme: dark)", color: "oklch(0.145 0 0)" },
  ],
};

const websiteInfo = {
  title: `${SITE_NAME} - The Houdini docs, instant and offline`,
  description:
    "A free, open-source desktop app for the Houdini docs. It reads the docs that come with your own Houdini install. Instant, and offline.",
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: websiteInfo.title,
  description: websiteInfo.description,
  authors: [{ name: SITE_NAME }],
  // Named here, not by the app/ file conventions. A file under app/ is a route,
  // and a route is a Worker invocation that starts Next: /icon.svg, /apple-icon.png
  // and /manifest.webmanifest cost one bootstrap each, on every first visit.
  // The same files in public/ are served by the asset server and never reach
  // the Worker. Measured 12 September 2026 — see lib/edge-cache.ts.
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: "/apple-touch-icon.png",
  },
  manifest: "/manifest.webmanifest",
  // The page for an agent: public/llms.txt.
  alternates: { types: { "text/markdown": "/llms.txt" } },
  openGraph: {
    title: websiteInfo.title,
    description: websiteInfo.description,
    url: SITE_URL,
    siteName: SITE_NAME,
    type: "website",
    images: ["/cover.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: websiteInfo.title,
    description: websiteInfo.description,
    images: ["/cover.png"],
  },
};

const geist = Geist({
  subsets: ["latin"],
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={geist.className}
      // The theme script below writes its attribute here before React
      // hydrates. React reports the difference; the difference is the point.
      suppressHydrationWarning
    >
      <head>
        {/* A deploy renames every chunk, so the last navigation served by the
            outgoing service worker gets HTML that names files which no longer
            exist. Reload that page one time, on the evidence that a chunk
            actually failed, so a healthy load pays nothing. This has to be
            inline and ahead of the chunks: when they 404 React never boots, so
            a listener attached from a component would never run. The flag stops
            a repeat if the asset is missing for some other reason.
            Production only: in dev, Turbopack serves chunks on demand, so a
            transient 404 while a page is still compiling is normal, not a
            stale deploy — reloading on it can loop instead of healing. */}
        {process.env.NODE_ENV === "production" && (
          <script
            dangerouslySetInnerHTML={{
              __html:
                "addEventListener('error',function(e){var t=e.target,u=t&&(t.src||t.href);" +
                "if(typeof u=='string'&&u.indexOf('/_next/static/')>-1&&!sessionStorage.getItem('hmd-heal')){" +
                "sessionStorage.setItem('hmd-heal','1');location.reload()}},true)",
            }}
          />
        )}
        <script dangerouslySetInnerHTML={{ __html: THEME_HEAD_SCRIPT }} />
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}

import type { APIRoute } from "astro";
import { homePaths, scriptzPaths, type PagePaths } from "../i18n";

// Pages for search engines, each with its other language. Account and app
// sign-in are noindex and stay out.
const pages: (PagePaths | string)[] = [homePaths, scriptzPaths, "/impressum/", "/datenschutz/"];

export const GET: APIRoute = ({ site }) => {
  const url = (path: string) => new URL(path, site).href;
  const entries = pages.flatMap((page) => {
    if (typeof page === "string") return [`<url><loc>${url(page)}</loc></url>`];
    const alternates = Object.entries(page)
      .map(([lang, path]) => `<xhtml:link rel="alternate" hreflang="${lang}" href="${url(path)}"/>`)
      .join("");
    return Object.values(page).map((path) => `<url><loc>${url(path)}</loc>${alternates}</url>`);
  });
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries.join("\n")}
</urlset>
`;
  return new Response(xml, { headers: { "Content-Type": "application/xml" } });
};

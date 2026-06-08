import type { APIRoute } from "astro";
import { site, absoluteUrl } from "../site.config";

const routes = [
  { path: "/", priority: 1.0, changefreq: "weekly" },
  { path: "/about", priority: 0.6, changefreq: "monthly" },
  { path: "/privacy", priority: 0.4, changefreq: "yearly" },
  { path: "/terms", priority: 0.4, changefreq: "yearly" },
  { path: "/disclaimer", priority: 0.3, changefreq: "yearly" },
  { path: "/contact", priority: 0.5, changefreq: "yearly" },
];

const today = new Date().toISOString().slice(0, 10);

export const GET: APIRoute = () => {
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${routes
  .map(
    (r) => `  <url>
    <loc>${absoluteUrl(r.path)}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${r.changefreq}</changefreq>
    <priority>${r.priority.toFixed(1)}</priority>
  </url>`,
  )
  .join("\n")}
</urlset>
`;
  // satisfy lint that `site` is used (TS strict noUnusedLocals via the import)
  void site;
  return new Response(body, { headers: { "Content-Type": "application/xml" } });
};

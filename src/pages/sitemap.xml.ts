import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { site, absoluteUrl } from "../site.config";

interface RouteEntry {
  path: string;
  priority: number;
  changefreq: "weekly" | "monthly" | "yearly";
  lastmod?: string;
}

const staticRoutes: RouteEntry[] = [
  { path: "/", priority: 1.0, changefreq: "weekly" },

  // Use-case landing pages (v0.4.5 SEO push)
  { path: "/youtube-captions", priority: 0.8, changefreq: "monthly" },
  { path: "/meeting-captions", priority: 0.8, changefreq: "monthly" },
  { path: "/podcast-captions", priority: 0.8, changefreq: "monthly" },
  { path: "/lecture-captions", priority: 0.8, changefreq: "monthly" },

  // Platform landing pages
  { path: "/captions-for-zoom", priority: 0.8, changefreq: "monthly" },
  { path: "/captions-for-google-meet", priority: 0.8, changefreq: "monthly" },

  // Install + blog index
  { path: "/install", priority: 0.7, changefreq: "monthly" },
  { path: "/blog", priority: 0.7, changefreq: "weekly" },

  // Trust pages
  { path: "/about", priority: 0.6, changefreq: "monthly" },
  { path: "/contact", priority: 0.5, changefreq: "yearly" },
  { path: "/privacy", priority: 0.4, changefreq: "yearly" },
  { path: "/terms", priority: 0.4, changefreq: "yearly" },
  { path: "/disclaimer", priority: 0.3, changefreq: "yearly" },
];

const today = new Date().toISOString().slice(0, 10);

export const GET: APIRoute = async () => {
  const posts = await getCollection("blog", ({ data }) => !data.draft);
  const blogRoutes: RouteEntry[] = posts.map((p) => ({
    path: `/blog/${p.id}`,
    priority: 0.6,
    changefreq: "monthly",
    lastmod: (p.data.updatedDate ?? p.data.pubDate).toISOString().slice(0, 10),
  }));

  const all = [
    ...staticRoutes.map((r) => ({ ...r, lastmod: r.lastmod ?? today })),
    ...blogRoutes,
  ];

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${all
  .map(
    (r) => `  <url>
    <loc>${absoluteUrl(r.path)}</loc>
    <lastmod>${r.lastmod}</lastmod>
    <changefreq>${r.changefreq}</changefreq>
    <priority>${r.priority.toFixed(1)}</priority>
  </url>`,
  )
  .join("\n")}
</urlset>
`;
  void site;
  return new Response(body, { headers: { "Content-Type": "application/xml" } });
};

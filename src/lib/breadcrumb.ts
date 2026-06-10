/**
 * Build a JSON-LD BreadcrumbList schema for subpages.
 *
 * Usage: `const bc = breadcrumb({ name: "Captions for Zoom", path: "/captions-for-zoom" });`
 * The first list item is auto-inserted as the home page (site.name → site.url).
 * Pass additional `{name, path}` crumbs as spread args — paths are absolute site
 * paths joined to site.url.
 */
import { site } from "../site.config";

export interface CrumbInput {
  name: string;
  path: string;
}

export function breadcrumb(...crumbs: CrumbInput[]) {
  const items = [
    {
      "@type": "ListItem",
      position: 1,
      name: site.name,
      item: site.url,
    },
    ...crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 2,
      name: c.name,
      item: new URL(c.path, site.url).toString(),
    })),
  ];

  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items,
  };
}

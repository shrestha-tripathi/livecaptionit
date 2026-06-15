/**
 * Single source of truth for ALL brand strings.
 *
 * Rules:
 *  - The literal "livecaptionit" / "LiveCaptionIt" must NOT appear anywhere
 *    else in src/. Use `site.name`, `site.shortName`, etc. instead.
 *  - All values can be overridden via PUBLIC_SITE_* env vars
 *    (e.g. in Cloudflare Pages dashboard) without code changes.
 *  - Defensive .pages.dev guard: Cloudflare Pages users sometimes leave
 *    the dashboard PUBLIC_SITE_URL set to the *.pages.dev value during
 *    pre-domain deploys; that stale value would otherwise poison canonical
 *    URLs, OG cards, and sitemap.xml forever. Detect and reject.
 */

const env = import.meta.env;

const rawSiteUrl = env.PUBLIC_SITE_URL ?? "https://livecaptionit.com";
const siteUrl = /\.pages\.dev/i.test(rawSiteUrl)
  ? "https://livecaptionit.com"
  : rawSiteUrl;

const rawDomain = env.PUBLIC_SITE_DOMAIN ?? "livecaptionit.com";
const domain = /\.pages\.dev/i.test(rawDomain)
  ? "livecaptionit.com"
  : rawDomain;

export const site = {
  name: env.PUBLIC_SITE_NAME ?? "LiveCaptionIt",
  shortName: env.PUBLIC_SITE_SHORT_NAME ?? "LiveCaptionIt",
  tagline:
    env.PUBLIC_SITE_TAGLINE ??
    "Live captions for any tab. Floats over anything. Never uploads.",
  description:
    env.PUBLIC_SITE_DESCRIPTION ??
    "Live captions for any audio your browser can hear — YouTube, podcasts, web meetings, lectures. Floats in a picture-in-picture window over any app. Runs Whisper locally in your browser via WebGPU. Audio never uploads.",
  domain,
  url: siteUrl,
  basePath: env.PUBLIC_BASE_PATH ?? "/",
  githubUrl:
    env.PUBLIC_GITHUB_URL ?? "https://github.com/shrestha-tripathi/livecaptionit",
  author: env.PUBLIC_SITE_AUTHOR ?? "Shrestha Tripathi",
  contactEmail:
    env.PUBLIC_SITE_CONTACT_EMAIL ?? "shrestha.tripathi@gmail.com",
  jurisdiction: env.PUBLIC_SITE_JURISDICTION ?? "India",
  locale: env.PUBLIC_SITE_LOCALE ?? "en",
  /**
   * Google Analytics 4 Measurement ID. PROD-gated in Layout (only injects
   * the gtag snippet on real deploys, never during local dev or preview
   * builds). Default is the livecaptionit.com production property. Override
   * via PUBLIC_GA_MEASUREMENT_ID env var on Cloudflare Pages for a fork.
   * Set to "" to disable analytics entirely.
   */
  gaId: env.PUBLIC_GA_MEASUREMENT_ID ?? "G-XZPZ13FET6",
} as const;

export type SiteConfig = typeof site;

/**
 * Normalize a path to ALWAYS end with a trailing slash (except a bare query/
 * hash or a real file like /sitemap.xml). Matches Cloudflare Pages' default
 * 308 /foo -> /foo/ behaviour so our sitemap, canonical, and internal links
 * all point straight at the URL that returns 200 — no redirect hop, no
 * canonical mismatch. astro.config sets `trailingSlash: "always"` to agree.
 */
export const withTrailingSlash = (path: string): string => {
  const [base, ...rest] = path.split(/(?=[?#])/);
  const suffix = rest.join("");
  if (base === "" || base === "/") return `/${suffix}`;
  const lastSeg = base.split("/").pop() ?? "";
  if (lastSeg.includes(".")) return `${base}${suffix}`;
  return base.endsWith("/") ? `${base}${suffix}` : `${base}/${suffix}`;
};

/** Build an absolute internal URL respecting basePath (always trailing-slashed). */
export const b = (path: string): string => {
  const cleanBase = site.basePath.replace(/\/+$/, "");
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return withTrailingSlash(`${cleanBase}${cleanPath}`);
};

/** Build an absolute URL (origin + path) for OG meta, canonical, sitemap. */
export const absoluteUrl = (path: string): string => {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${site.url}${withTrailingSlash(cleanPath)}`;
};

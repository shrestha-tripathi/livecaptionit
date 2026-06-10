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

/** Build an absolute internal URL respecting basePath. */
export const b = (path: string): string => {
  const cleanBase = site.basePath.replace(/\/+$/, "");
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${cleanBase}${cleanPath}`;
};

/** Build an absolute URL (origin + path) for OG meta, canonical, sitemap. */
export const absoluteUrl = (path: string): string => {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${site.url}${cleanPath}`;
};

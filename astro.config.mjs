// @ts-check
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

// Read the same env var the runtime site.config.ts reads so SSR-time
// helpers (sitemap, OG image gen) get a consistent value.
const env = process.env;
const rawSiteUrl = env.PUBLIC_SITE_URL ?? "https://livecaptionit.com";
const siteUrl = /\.pages\.dev/i.test(rawSiteUrl)
  ? "https://livecaptionit.com"
  : rawSiteUrl;

// https://astro.build/config
export default defineConfig({
  site: siteUrl,
  // "always" → built pages live at /foo/index.html and Astro.url.pathname
  // carries the trailing slash, matching Cloudflare Pages' 308 /foo → /foo/
  // behaviour. Keeps sitemap + canonical + internal links on the 200 URL
  // (no redirect hop, no "Alternate page with canonical" warning in GSC).
  trailingSlash: "always",
  vite: {
    plugins: [tailwindcss()],
    // Mirror the production _headers COOP/COEP setup so SharedArrayBuffer
    // (required for transformers.js multi-threaded WASM perf) works in dev
    // too. Without this, `npm run dev` is single-threaded WASM — testing
    // ends up slower than production and we'd miss perf regressions.
    server: {
      headers: {
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "credentialless",
      },
    },
    preview: {
      headers: {
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "credentialless",
      },
    },
  },
});

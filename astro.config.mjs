// @ts-check
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

// Read the same env var the runtime site.config.ts reads so SSR-time
// helpers (sitemap, OG image gen) get a consistent value.
const env = process.env;
const rawSiteUrl = env.PUBLIC_SITE_URL ?? "https://captionpip.com";
const siteUrl = /\.pages\.dev/i.test(rawSiteUrl)
  ? "https://captionpip.com"
  : rawSiteUrl;

// https://astro.build/config
export default defineConfig({
  site: siteUrl,
  vite: {
    plugins: [tailwindcss()],
  },
});

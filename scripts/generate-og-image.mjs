/**
 * Generate /public/og-image.png (1200×630) — the Open Graph + Twitter card image
 * used in social shares, link unfurling (Discord, Slack, Telegram, Twitter, LinkedIn).
 *
 * Run via `node scripts/generate-og-image.mjs`. Re-run when brand mark, tagline,
 * or domain changes — output is committed to git so it's available at build time.
 *
 * Design: dark-gradient backdrop + the brand mark from favicon.svg on the left,
 * "LiveCaptionIt" wordmark + tagline on the right. Brand-cyan gradient accent
 * for visual recognition. Matches the same visual identity as the favicon and
 * PWA icons (oklch cyan family approximated to sRGB hex for raster compatibility
 * — librsvg doesn't support oklch).
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const W = 1200;
const H = 630;

// Brand cyan family — matches the favicon.svg + PWA icon palette.
const BRAND_LIGHT = "#22d3ee";  // oklch(78% 0.14 200)
const BRAND_STRONG = "#0891b2"; // oklch(60% 0.16 200)
const BRAND_DEEP = "#0e7490";   // oklch(50% 0.13 200)

// Dark backdrop with subtle cyan glow in the bottom-left so the brand mark
// reads against it. Pure flat black feels lifeless; the gradient adds depth
// without competing with the wordmark.
const ogSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="glow" cx="20%" cy="80%" r="60%">
      <stop offset="0%" stop-color="${BRAND_DEEP}" stop-opacity="0.55"/>
      <stop offset="60%" stop-color="${BRAND_DEEP}" stop-opacity="0.05"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="markGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${BRAND_LIGHT}"/>
      <stop offset="100%" stop-color="${BRAND_STRONG}"/>
    </linearGradient>
    <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="${BRAND_LIGHT}"/>
      <stop offset="100%" stop-color="${BRAND_STRONG}"/>
    </linearGradient>
  </defs>

  <!-- Backdrop: near-black with cyan glow bottom-left -->
  <rect width="${W}" height="${H}" fill="#0a0a0a"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>

  <!-- Brand mark: speech bubble + mini-bubble (matches favicon.svg) -->
  <g transform="translate(110, 195) scale(8.5)">
    <path d="M 4 6 Q 4 3, 7 3 L 22 3 Q 25 3, 25 6 L 25 16 Q 25 19, 22 19 L 13 19 L 9 23 L 9 19 L 7 19 Q 4 19, 4 16 Z" fill="url(#markGrad)"/>
    <rect x="17" y="20" width="12" height="9" rx="2.5" fill="${BRAND_STRONG}"/>
    <rect x="17" y="20" width="12" height="9" rx="2.5" fill="none" stroke="white" stroke-width="1.5" stroke-opacity="0.4"/>
    <g stroke="white" stroke-linecap="round" stroke-width="1.6">
      <line x1="8" y1="8.5" x2="20" y2="8.5" opacity="0.95"/>
      <line x1="8" y1="12" x2="17" y2="12" opacity="0.75"/>
      <line x1="8" y1="15.5" x2="14" y2="15.5" opacity="0.55"/>
    </g>
  </g>

  <!-- Wordmark + tagline -->
  <g font-family="system-ui, -apple-system, 'Segoe UI', sans-serif">
    <!-- Tiny brand pill above the wordmark -->
    <g transform="translate(460, 175)">
      <rect x="0" y="0" width="320" height="32" rx="16" fill="${BRAND_DEEP}" fill-opacity="0.4"/>
      <circle cx="18" cy="16" r="4" fill="${BRAND_LIGHT}"/>
      <text x="32" y="22" fill="${BRAND_LIGHT}" font-size="14" font-weight="600" letter-spacing="1.2">
        100% LOCAL · WEBGPU + WHISPER
      </text>
    </g>

    <!-- Headline -->
    <text x="460" y="280" fill="#ffffff" font-size="74" font-weight="800" letter-spacing="-1.5">
      LiveCaptionIt
    </text>
    <text x="460" y="345" fill="#d4d4d8" font-size="36" font-weight="500" letter-spacing="-0.5">
      Live captions for any tab.
    </text>
    <text x="460" y="395" fill="#a1a1aa" font-size="32" font-weight="400" letter-spacing="-0.5">
      Floats over anything. Never uploads.
    </text>

    <!-- Bottom accent bar -->
    <rect x="460" y="430" width="80" height="4" rx="2" fill="url(#accent)"/>

    <!-- Domain footer -->
    <text x="460" y="490" fill="#71717a" font-size="22" font-weight="500" letter-spacing="0.5">
      livecaptionit.com
    </text>
  </g>
</svg>`;

await sharp(Buffer.from(ogSvg))
  .png({ compressionLevel: 9, adaptiveFiltering: true })
  .toFile(resolve(root, "public/og-image.png"));

const { size } = await import("node:fs").then((m) =>
  m.promises.stat(resolve(root, "public/og-image.png")),
);
console.log(`✓ public/og-image.png (${W}×${H}, ${(size / 1024).toFixed(1)} KB)`);
console.log("Done.");

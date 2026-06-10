/**
 * Generate PWA icons (192/512 px PNG) + maskable variant from favicon.svg.
 * Run via `node scripts/generate-pwa-icons.mjs`. Re-run only when brand mark changes.
 *
 * librsvg (sharp's renderer) doesn't support oklch() — substitute hex for raster.
 * The source favicon.svg keeps oklch() for browsers (full color fidelity).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const sourceSvg = readFileSync(resolve(root, "public/favicon.svg"), "utf8");

// OKLCH → sRGB hex approximations (cyan family, brand-equivalent).
const rasterSvg = sourceSvg
  .replaceAll("oklch(78% 0.14 200)", "#22d3ee")
  .replaceAll("oklch(60% 0.16 200)", "#0891b2");

async function emit(filename, size, padding = 0) {
  // Maskable icons need ~10% padding inside a solid background so they
  // survive Android's circular/rounded-square mask.
  const bg = padding > 0
    ? { create: { width: size, height: size, channels: 4, background: "#0e7490" } }
    : null;

  if (bg) {
    const inner = size - padding * 2;
    const innerPng = await sharp(Buffer.from(rasterSvg))
      .resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    await sharp(bg)
      .composite([{ input: innerPng, top: padding, left: padding }])
      .png()
      .toFile(resolve(root, "public", filename));
  } else {
    await sharp(Buffer.from(rasterSvg))
      .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(resolve(root, "public", filename));
  }
  console.log(`✓ ${filename} (${size}×${size}${padding ? ` maskable +${padding}px pad` : ""})`);
}

await emit("icon-192.png", 192);
await emit("icon-512.png", 512);
await emit("icon-maskable-512.png", 512, 64); // 12.5% padding → safe-zone compliant
console.log("Done.");

import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(import.meta.dirname, "..");
const RES_DIR = path.join(ROOT, "android", "app", "src", "main", "res");

// Official DualLane v1.0 Master Brand Mark — 04 · 叠境双晶 (Liquid Vibrancy Panes)
const LAUNCHER_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg viewBox="0 0 512 512" width="512" height="512" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="tileBg" cx="22%" cy="15%" r="110%">
      <stop offset="0%" stop-color="#1E2D45" />
      <stop offset="62%" stop-color="#0B111B" />
      <stop offset="100%" stop-color="#060A11" />
    </radialGradient>
    <clipPath id="clipBlue">
      <rect x="116" y="148" width="192" height="236" rx="56" transform="rotate(-12 212 266)" />
    </clipPath>
    <linearGradient id="blueGrad" x1="0%" y1="12%" x2="95%" y2="88%">
      <stop offset="0%" stop-color="#BAE6FD" />
      <stop offset="45%" stop-color="#0EA5E9" />
      <stop offset="100%" stop-color="#0369A1" />
    </linearGradient>
    <linearGradient id="amberGrad" x1="0%" y1="12%" x2="95%" y2="88%">
      <stop offset="0%" stop-color="#FDE68A" />
      <stop offset="45%" stop-color="#F97316" />
      <stop offset="100%" stop-color="#C2410C" />
    </linearGradient>
    <linearGradient id="lensGrad" x1="20%" y1="10%" x2="80%" y2="90%">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.96" />
      <stop offset="55%" stop-color="#E0F2FE" stop-opacity="0.84" />
      <stop offset="100%" stop-color="#FED7AA" stop-opacity="0.78" />
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="116" fill="url(#tileBg)" />
  <rect x="116" y="148" width="192" height="236" rx="56" transform="rotate(-12 212 266)" fill="url(#blueGrad)" />
  <rect x="204" y="128" width="192" height="236" rx="56" transform="rotate(12 300 246)" fill="url(#amberGrad)" fill-opacity="0.92" />
  <g clip-path="url(#clipBlue)">
    <rect x="204" y="128" width="192" height="236" rx="56" transform="rotate(12 300 246)" fill="url(#lensGrad)" />
  </g>
</svg>`;

const ADAPTIVE_FG_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg viewBox="0 0 432 432" width="432" height="432" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <clipPath id="clipBlueFg">
      <rect x="122" y="136" width="132" height="164" rx="38" transform="rotate(-12 188 218)" />
    </clipPath>
    <linearGradient id="blueGradFg" x1="0%" y1="12%" x2="95%" y2="88%">
      <stop offset="0%" stop-color="#BAE6FD" />
      <stop offset="45%" stop-color="#0EA5E9" />
      <stop offset="100%" stop-color="#0369A1" />
    </linearGradient>
    <linearGradient id="amberGradFg" x1="0%" y1="12%" x2="95%" y2="88%">
      <stop offset="0%" stop-color="#FDE68A" />
      <stop offset="45%" stop-color="#F97316" />
      <stop offset="100%" stop-color="#C2410C" />
    </linearGradient>
    <linearGradient id="lensGradFg" x1="20%" y1="10%" x2="80%" y2="90%">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.96" />
      <stop offset="55%" stop-color="#E0F2FE" stop-opacity="0.84" />
      <stop offset="100%" stop-color="#FED7AA" stop-opacity="0.78" />
    </linearGradient>
  </defs>
  <rect x="122" y="136" width="132" height="164" rx="38" transform="rotate(-12 188 218)" fill="url(#blueGradFg)" />
  <rect x="182" y="122" width="132" height="164" rx="38" transform="rotate(12 248 204)" fill="url(#amberGradFg)" fill-opacity="0.92" />
  <g clip-path="url(#clipBlueFg)">
    <rect x="182" y="122" width="132" height="164" rx="38" transform="rotate(12 248 204)" fill="url(#lensGradFg)" />
  </g>
</svg>`;

const DENSITIES = [
  { folder: "mipmap-mdpi", launcher: 48, fg: 108 },
  { folder: "mipmap-hdpi", launcher: 72, fg: 162 },
  { folder: "mipmap-xhdpi", launcher: 96, fg: 216 },
  { folder: "mipmap-xxhdpi", launcher: 144, fg: 324 },
  { folder: "mipmap-xxxhdpi", launcher: 192, fg: 432 },
];

async function buildIcons() {
  for (const d of DENSITIES) {
    const outDir = path.join(RES_DIR, d.folder);
    await mkdir(outDir, { recursive: true });
    await sharp(Buffer.from(LAUNCHER_SVG))
      .resize(d.launcher, d.launcher)
      .png({ compressionLevel: 9 })
      .toFile(path.join(outDir, "ic_launcher.png"));
    await sharp(Buffer.from(LAUNCHER_SVG))
      .resize(d.launcher, d.launcher)
      .png({ compressionLevel: 9 })
      .toFile(path.join(outDir, "ic_launcher_round.png"));
    await sharp(Buffer.from(ADAPTIVE_FG_SVG))
      .resize(d.fg, d.fg)
      .png({ compressionLevel: 9 })
      .toFile(path.join(outDir, "ic_launcher_foreground.png"));
  }
  process.stdout.write("Generated official DualLane v1.0 叠境双晶 Android launcher icons.\n");
}

await buildIcons();

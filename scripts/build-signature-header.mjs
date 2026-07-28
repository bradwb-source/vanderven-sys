import sharp from "sharp";
import opentype from "opentype.js";
import fs from "node:fs";

const logoPath = "site/public/logo-signature.png";
const outPath = "site/public/signature-brad-header.png";

function loadFont(filePath) {
  const buf = fs.readFileSync(filePath);
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

const georgia = loadFont("C:/Windows/Fonts/georgia.ttf");
const georgiaBold = loadFont("C:/Windows/Fonts/georgiab.ttf");
const georgiaItalic = loadFont("C:/Windows/Fonts/georgiai.ttf");
// Lining figures (even digit heights). Georgia’s default digits are oldstyle/uneven.
const times = loadFont("C:/Windows/Fonts/times.ttf");

function textPath(font, str, x, y, size, fill) {
  const p = font.getPath(str, x, y, size);
  return `<path d="${p.toPathData(2)}" fill="${fill}" />`;
}

const logoMeta = await sharp(logoPath).metadata();
const logoH = 120;
const logoW = Math.round((logoMeta.width / logoMeta.height) * logoH);
const logoBuf = await sharp(logoPath)
  .resize({ width: logoW, height: logoH, fit: "fill", withoutEnlargement: false })
  .png()
  .toBuffer();

const textX = logoW + 28;
const lineX = logoW + 14;
const textBlock = 280;
const W = Math.max(logoW + 8, textX + textBlock);
const H = 154;

const paths = [
  textPath(georgiaBold, "Brad Boudreau", textX, 32, 24, "#9aa0a6"),
  textPath(georgiaItalic, "Owner / Head AI Architect", textX, 56, 15, "#8a7340"),
  textPath(georgia, "Vanderven Systems", textX, 78, 15, "#8a7340"),
  textPath(times, "Mobile: 1-587-859-9115", textX, 104, 15, "#8a7340"),
  textPath(georgia, "Brad@vanderven.ca", textX, 126, 15, "#8a7340"),
  textPath(georgia, "Vanderven.ca", textX, 148, 15, "#8a7340"),
].join("\n  ");

const svg = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <line x1="${lineX}" y1="12" x2="${lineX}" y2="${H - 12}" stroke="#8a7340" stroke-width="2" />
  ${paths}
</svg>`);

const textLayer = await sharp(svg).png().toBuffer();

await sharp({
  create: {
    width: W,
    height: H,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  },
})
  .composite([
    { input: logoBuf, left: 0, top: Math.round((H - logoH) / 2) },
    { input: textLayer, left: 0, top: 0 },
  ])
  .png()
  .toFile(outPath);

const finalMeta = await sharp(outPath).metadata();
console.log("wrote", outPath, finalMeta.width, "x", finalMeta.height, {
  logoW,
  logoH,
  textX,
  lineX,
});

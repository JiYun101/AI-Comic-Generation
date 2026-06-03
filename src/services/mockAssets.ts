import { CharacterTemplate, ComicPage, ExportRatio } from "../types";
import { svgDataUri } from "../lib/utils";

const ratioSize: Record<ExportRatio, { width: number; height: number }> = {
  "3:4": { width: 900, height: 1200 },
  "4:5": { width: 1080, height: 1350 },
  "1:1": { width: 1080, height: 1080 }
};

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wrapText(value: string, max = 17) {
  const chars = Array.from(value);
  const lines: string[] = [];
  for (let index = 0; index < chars.length; index += max) {
    lines.push(chars.slice(index, index + max).join(""));
  }
  return lines.slice(0, 4);
}

export function createMockComicImage(page: ComicPage, accent = "#57c7b6") {
  const { width, height } = ratioSize[page.ratio];
  const title = escapeXml(page.title);
  const beatLines = wrapText(page.beat, page.ratio === "1:1" ? 15 : 18).map(escapeXml);
  const shotLines = wrapText(page.shot, page.ratio === "1:1" ? 14 : 17).map(escapeXml);
  const dogY = Math.round(height * 0.5);
  const panelBottom = height - 210;
  const lineGap = 44;

  const beatSvg = beatLines
    .map((line, index) => `<text x="78" y="${height - 144 + index * lineGap}" class="caption">${line}</text>`)
    .join("");
  const shotSvg = shotLines
    .map((line, index) => `<text x="${width - 78}" y="${118 + index * 35}" class="note" text-anchor="end">${line}</text>`)
    .join("");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <style>
      .title{font:700 48px "Microsoft YaHei",Arial,sans-serif;fill:#111827}
      .caption{font:600 34px "Microsoft YaHei",Arial,sans-serif;fill:#111827}
      .note{font:500 24px "Microsoft YaHei",Arial,sans-serif;fill:#475569}
      .small{font:600 22px "Microsoft YaHei",Arial,sans-serif;fill:#64748b}
      .stroke{stroke:#111827;stroke-width:9;stroke-linecap:round;stroke-linejoin:round;fill:none}
    </style>
  </defs>
  <rect width="100%" height="100%" fill="#f8fafc"/>
  <rect x="42" y="42" width="${width - 84}" height="${height - 84}" rx="18" fill="#ffffff" stroke="#dbe3ea" stroke-width="3"/>
  <rect x="64" y="64" width="${width - 128}" height="${panelBottom - 64}" rx="14" fill="#f1f5f9"/>
  <circle cx="${width - 150}" cy="160" r="92" fill="${accent}" opacity=".22"/>
  <path d="M108 ${panelBottom - 90} C260 ${panelBottom - 170}, 408 ${panelBottom - 35}, 562 ${panelBottom - 112} S760 ${panelBottom - 74}, ${width - 96} ${panelBottom - 132}" stroke="${accent}" stroke-width="16" fill="none" opacity=".45"/>
  <text x="78" y="126" class="title">${title}</text>
  ${shotSvg}
  <g transform="translate(${Math.round(width * 0.5 - 140)} ${dogY - 140})">
    <path class="stroke" d="M86 112 C88 56, 134 30, 194 46 C248 60, 286 102, 282 162 C278 232, 220 268, 150 256 C96 247, 78 197, 86 112 Z" fill="#fff"/>
    <path class="stroke" d="M112 62 C88 24, 46 28, 42 82 C66 72, 90 70, 112 62 Z" fill="#fff"/>
    <path class="stroke" d="M224 58 C248 20, 292 28, 294 82 C268 72, 246 68, 224 58 Z" fill="#fff"/>
    <circle cx="132" cy="136" r="10" fill="#111827"/>
    <circle cx="218" cy="136" r="10" fill="#111827"/>
    <path class="stroke" d="M166 158 C178 170, 194 168, 204 156"/>
    <path class="stroke" d="M118 256 L100 314 M222 252 L240 314"/>
    <path class="stroke" d="M282 166 C340 168, 350 106, 314 96"/>
  </g>
  <rect x="64" y="${height - 194}" width="${width - 128}" height="130" rx="12" fill="#ffffff" stroke="#dbe3ea" stroke-width="3"/>
  ${beatSvg}
  <text x="${width - 78}" y="${height - 82}" class="small" text-anchor="end">PAGE ${page.pageNumber.toString().padStart(2, "0")}</text>
</svg>`;

  return svgDataUri(svg);
}

export function createMockCharacterSheet(character: CharacterTemplate) {
  const [ink = "#111827", paper = "#ffffff", accent = "#57c7b6"] = character.palette.split(",");
  const name = escapeXml(character.name || "新角色");
  const descriptionLines = wrapText(character.description || "角色设定图 / 三视图 / 多视角参考。", 22).map(escapeXml);
  const promptLines = wrapText(character.prompt || "clean original comic character design", 30).slice(0, 3).map(escapeXml);
  const views = ["正面", "侧面", "背面", "表情"];

  const viewSvg = views
    .map((view, index) => {
      const x = 86 + index * 214;
      const headY = 254 + (index % 2) * 8;
      return `<g transform="translate(${x} 0)">
        <rect x="0" y="160" width="160" height="320" rx="18" fill="${paper}" stroke="#d9d4c8" stroke-width="3"/>
        <circle cx="80" cy="${headY}" r="54" fill="#fff" stroke="${ink}" stroke-width="7"/>
        <path d="M42 ${headY - 44} C78 ${headY - 84}, 124 ${headY - 50}, 122 ${headY - 8}" fill="none" stroke="${accent}" stroke-width="12" stroke-linecap="round"/>
        <path d="M52 ${headY + 74} C68 ${headY + 126}, 94 ${headY + 126}, 110 ${headY + 74}" fill="#fff" stroke="${ink}" stroke-width="7" stroke-linecap="round"/>
        <path d="M52 ${headY + 144} L38 ${headY + 216} M108 ${headY + 144} L122 ${headY + 216}" stroke="${ink}" stroke-width="7" stroke-linecap="round"/>
        <circle cx="62" cy="${headY - 4}" r="6" fill="${ink}" opacity="${view === "背面" ? "0" : "1"}"/>
        <circle cx="98" cy="${headY - 4}" r="6" fill="${ink}" opacity="${view === "背面" ? "0" : "1"}"/>
        <path d="M66 ${headY + 22} C76 ${headY + 32}, 90 ${headY + 32}, 100 ${headY + 22}" fill="none" stroke="${ink}" stroke-width="5" stroke-linecap="round" opacity="${view === "背面" ? "0" : "1"}"/>
        <text x="80" y="526" text-anchor="middle" class="view">${view}</text>
      </g>`;
    })
    .join("");

  const descriptionSvg = descriptionLines.map((line, index) => `<text x="76" y="${666 + index * 34}" class="copy">${line}</text>`).join("");
  const promptSvg = promptLines.map((line, index) => `<text x="76" y="${806 + index * 30}" class="small">${line}</text>`).join("");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1200" viewBox="0 0 1000 1200">
  <defs>
    <style>
      .title{font:700 42px "Microsoft YaHei",Arial,sans-serif;fill:#111827}
      .label{font:600 22px "Microsoft YaHei",Arial,sans-serif;fill:#0f766e}
      .copy{font:500 25px "Microsoft YaHei",Arial,sans-serif;fill:#374151}
      .small{font:500 20px "Microsoft YaHei",Arial,sans-serif;fill:#64748b}
      .view{font:700 24px "Microsoft YaHei",Arial,sans-serif;fill:#111827}
    </style>
  </defs>
  <rect width="100%" height="100%" fill="#f8f5ed"/>
  <rect x="42" y="42" width="916" height="1116" rx="24" fill="#ffffff" stroke="#ded8cc" stroke-width="3"/>
  <text x="76" y="112" class="label">Character Sheet / 三视图参考</text>
  <text x="76" y="168" class="title">${name}</text>
  <rect x="70" y="196" width="860" height="386" rx="18" fill="#f7f3ea"/>
  ${viewSvg}
  <text x="76" y="624" class="label">人设描述</text>
  ${descriptionSvg}
  <text x="76" y="766" class="label">提示词核心</text>
  ${promptSvg}
</svg>`;

  return svgDataUri(svg);
}

export async function imageUrlToBlob(url: string) {
  const response = await fetch(url);
  return response.blob();
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load image for export."));
    image.src = url;
  });
}

export async function createLongComicImage(pages: ComicPage[]) {
  const imagePages = pages.filter((page) => page.imageUrl);
  if (!imagePages.length) return undefined;

  const loaded = await Promise.all(
    imagePages.map(async (page) => ({
      page,
      image: await loadImage(page.imageUrl!)
    }))
  );

  const width = Math.max(...loaded.map(({ image }) => image.naturalWidth || image.width));
  const heights = loaded.map(({ image }) => {
    const imageWidth = image.naturalWidth || image.width;
    const imageHeight = image.naturalHeight || image.height;
    return Math.round((imageHeight * width) / imageWidth);
  });
  const height = heights.reduce((sum, item) => sum + item, 0);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas export is not available.");

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  let y = 0;
  loaded.forEach(({ image }, index) => {
    context.drawImage(image, 0, y, width, heights[index]);
    y += heights[index];
  });

  return canvas.toDataURL("image/png");
}

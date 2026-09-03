export interface ReviewDocument {
  title: string;
  subtitle?: string;
  lines: string[];
}
export interface ExportFile {
  blob: Blob;
  filename: string;
}
const filename = (title: string) =>
  title.replace(/[^a-z0-9_-]/gi, "-").slice(0, 100) || "journal-review";
export async function buildReviewPdf(doc: ReviewDocument, fontBytes: ArrayBuffer | Uint8Array) {
  const [{ PDFDocument, rgb }, { default: fontkit }] = await Promise.all([
    import("pdf-lib"),
    import("@pdf-lib/fontkit"),
  ]);
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fontBytes, { subset: true });
  const supported = new Set(font.getCharacterSet());
  const allText = [doc.title, doc.subtitle ?? "", ...doc.lines].join("\n");
  const missing = [
    ...new Set([...allText].filter((c) => !/\s/.test(c) && !supported.has(c.codePointAt(0)!))),
  ];
  if (missing.length)
    throw new Error(
      `PDF font does not support these characters: ${missing.slice(0, 8).join(" ")}. Remove them for this export, or export a PNG review.`,
    );
  pdf.setTitle(doc.title);
  pdf.setCreator("Trade Journal");
  let page = pdf.addPage([595, 842]),
    y = 786;
  const addPage = () => {
    page = pdf.addPage([595, 842]);
    y = 786;
  };
  const draw = (text: string, size: number, color = rgb(0.16, 0.19, 0.24)) => {
    const max = 499;
    let line = "";
    // Character wrapping also handles URLs and long unbroken symbols.
    for (const char of text) {
      if (font.widthOfTextAtSize(line + char, size) > max && line) {
        if (y < 65) addPage();
        page.drawText(line, { x: 48, y, size, font, color });
        y -= size * 1.55;
        line = "";
      }
      line += char === "\t" ? "  " : char;
    }
    if (y < 65) addPage();
    page.drawText(line || " ", { x: 48, y, size, font, color });
    y -= size * 1.55;
  };
  draw(doc.title, 22);
  if (doc.subtitle) draw(doc.subtitle, 10, rgb(0.4, 0.44, 0.5));
  y -= 14;
  for (const line of doc.lines.flatMap((s) => s.split("\n"))) {
    const heading = /^#{1,6}\s/.test(line);
    const clean = line
      .replace(/^#{1,6}\s+/, "")
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/^- \[x\]/gi, "[done]")
      .replace(/^- \[ \]/g, "[ ]");
    draw(clean, heading ? 14 : 10);
    if (heading) y -= 4;
  }
  const pages = pdf.getPages();
  pages.forEach((p, i) =>
    p.drawText(`Trade Journal  |  ${i + 1} / ${pages.length}`, {
      x: 48,
      y: 30,
      size: 8,
      font,
      color: rgb(0.5, 0.5, 0.5),
    }),
  );
  return new Uint8Array(await pdf.save());
}
export async function exportPdf(doc: ReviewDocument) {
  const response = await fetch("/fonts/NotoSans-Regular.ttf");
  if (!response.ok) throw new Error("Could not load the PDF font.");
  const bytes = await buildReviewPdf(doc, await response.arrayBuffer());
  return [
    {
      blob: new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
      filename: `${filename(doc.title)}.pdf`,
    },
  ];
}

export async function exportPng(doc: ReviewDocument) {
  await document.fonts.ready;
  const canvas = document.createElement("canvas"),
    ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Image export is unavailable in this browser.");
  canvas.width = 1200;
  ctx.font = "24px Arial";
  const lines: string[] = [];
  for (const source of doc.lines.flatMap((s) => s.split("\n"))) {
    let line = "";
    for (const char of source) {
      if (ctx.measureText(line + char).width > 1040 && line) {
        lines.push(line);
        line = "";
      }
      line += char;
    }
    lines.push(line);
  }
  const pages = Math.max(1, Math.ceil(lines.length / 55));
  const files: ExportFile[] = [];
  // A long review is exported as numbered cards, without clipping its content.
  for (let i = 0; i < pages; i++) {
    const chunk = lines.slice(i * 55, (i + 1) * 55);
    canvas.height = Math.max(600, 300 + chunk.length * 38);
    ctx.fillStyle = "#0c1017";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const gradient = ctx.createLinearGradient(0, 0, 1200, 0);
    gradient.addColorStop(0, "#48dcbc");
    gradient.addColorStop(1, "#a480f4");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 1200, 8);
    ctx.fillStyle = "#8d9aaf";
    ctx.font = "22px Arial";
    ctx.fillText(`TRADE JOURNAL${pages > 1 ? ` · ${i + 1}/${pages}` : ""}`, 80, 70);
    ctx.fillStyle = "#f4f7fb";
    ctx.font = "bold 38px Arial";
    ctx.fillText(doc.title, 80, 130, 1040);
    ctx.fillStyle = "#9daec4";
    ctx.font = "20px Arial";
    ctx.fillText(doc.subtitle ?? "", 80, 174, 1040);
    ctx.fillStyle = "#d9e2ef";
    ctx.font = "24px Arial";
    chunk.forEach((line, j) => ctx.fillText(line, 80, 244 + j * 38));
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Image export failed."))),
        "image/png",
      ),
    );
    files.push({ blob, filename: `${filename(doc.title)}${pages > 1 ? `-${i + 1}` : ""}.png` });
  }
  return files;
}

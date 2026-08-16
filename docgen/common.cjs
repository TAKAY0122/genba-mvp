const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, PageBreak,
  Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle,
  Header, Footer, PageNumber, NumberFormat, VerticalAlign, ImageRun,
} = require("docx");
const fs = require("fs");
const path = require("path");

const NAVY = "1B2333";
const GOLD = "C9A227";
const GRAY = "666666";
const LGRAY = "F2F2F2";

function h1(text) {
  return new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 200 },
    children: [new TextRun({ text, bold: true, size: 30, color: NAVY })] });
}
function h2(text) {
  return new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 300, after: 150 },
    children: [new TextRun({ text, bold: true, size: 24, color: NAVY })] });
}
function h3(text) {
  return new Paragraph({ heading: HeadingLevel.HEADING_3, spacing: { before: 200, after: 100 },
    children: [new TextRun({ text, bold: true, size: 21, color: GOLD })] });
}
function p(text, opts = {}) {
  return new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text, size: 20, ...opts })] });
}
function bullet(text) {
  return new Paragraph({ spacing: { after: 60 }, indent: { left: 300 },
    children: [new TextRun({ text: "・" + text, size: 20 })] });
}

function cellText(text, opts = {}) {
  return new TableCell({
    width: { size: opts.width || 2000, type: WidthType.DXA },
    shading: opts.header ? { type: ShadingType.CLEAR, fill: NAVY } : undefined,
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 80, bottom: 80, left: 100, right: 100 },
    children: [new Paragraph({
      children: [new TextRun({ text: String(text), size: 18, bold: !!opts.header, color: opts.header ? "FFFFFF" : "000000" })],
    })],
  });
}

/** headerCols: [{text, width}] / rows: [[c1,c2,...]] */
function makeTable(headerCols, rows) {
  const widths = headerCols.map((c) => c.width);
  return new Table({
    width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: widths,
    rows: [
      new TableRow({
        tableHeader: true,
        children: headerCols.map((c) => cellText(c.text, { header: true, width: c.width })),
      }),
      ...rows.map((r) => new TableRow({
        children: r.map((v, i) => cellText(v, { width: widths[i] })),
      })),
    ],
  });
}

function coverCompanyBlock() {
  const logoPath = path.join(__dirname, "logo_cropped.png");
  const logoBlock = [];
  if (fs.existsSync(logoPath)) {
    const dims = fs.readFileSync(logoPath);
    const w = 260, h = Math.round(260 * (293 / 898)); // 元画像比率(898x293)を維持
    logoBlock.push(new Paragraph({
      spacing: { before: 1400 }, alignment: AlignmentType.CENTER,
      children: [new ImageRun({ data: dims, type: "png", transformation: { width: w, height: h } })],
    }));
  }
  return [
    ...logoBlock,
    new Paragraph({ spacing: { before: logoBlock.length ? 300 : 1400 }, alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: "株式会社 Aster Systems", bold: true, size: 28, color: NAVY })] }),
    new Paragraph({ spacing: { before: 500 }, alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: "担当: 吉崎 天晴", size: 20, color: "000000" })] }),
  ];
}

function makeCover(docType, versionLabel = "Version 1.0", dateLabel = "2026年7月") {
  return [
    new Paragraph({ spacing: { before: 1400 }, alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: "現場運営支援システム", bold: true, size: 44, color: NAVY })] }),
    new Paragraph({ spacing: { before: 200 }, alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: "(genba-mvp)", size: 22, color: GRAY })] }),
    new Paragraph({ spacing: { before: 500 }, alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: docType, bold: true, size: 32 })] }),
    new Paragraph({ spacing: { before: 200 }, alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: versionLabel, bold: true, size: 22, color: GOLD })] }),
    new Paragraph({ spacing: { before: 300 }, alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: dateLabel, size: 18, color: GRAY })] }),
    ...coverCompanyBlock(),
    new Paragraph({ children: [new PageBreak()] }),
  ];
}
function revisionHistory(rows) {
  const out = [h1("改訂履歴")];
  out.push(makeTable(
    [{ text: "version", width: 1400 }, { text: "日付", width: 2200 }, { text: "内容", width: 6800 }],
    rows,
  ));
  out.push(new Paragraph({ children: [new PageBreak()] }));
  return out;
}

function headerFooter(title) {
  return {
    headers: {
      default: new Header({
        children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC" } },
          children: [new TextRun({ text: title, size: 16, color: GRAY })],
        })],
      }),
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ children: [PageNumber.CURRENT], size: 16, color: GRAY })],
        })],
      }),
    },
  };
}

/* 簡易構成図: 罫線付きセルを「箱」として使い、矢印記号で繋ぐ */
function diagramBox(text, opts = {}) {
  return new Table({
    width: { size: opts.width || 6000, type: WidthType.DXA },
    columnWidths: [opts.width || 6000],
    alignment: AlignmentType.CENTER,
    rows: [new TableRow({ children: [new TableCell({
      width: { size: opts.width || 6000, type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, fill: opts.fill || "EEF1F8" },
      margins: { top: 160, bottom: 160, left: 160, right: 160 },
      verticalAlign: VerticalAlign.CENTER,
      children: (Array.isArray(text) ? text : [text]).map((line) => new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: line, bold: !!opts.bold, size: opts.size || 19, color: opts.color || "1B2333" })],
      })),
    })] })],
  });
}
function diagramArrow(label) {
  return new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { before: 40, after: 40 },
    children: [new TextRun({ text: label ? `↓ ${label}` : "↓", size: 18, color: GRAY })],
  });
}

module.exports = {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, PageBreak,
  Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle, NumberFormat, ImageRun,
  NAVY, GOLD, GRAY, LGRAY,
  h1, h2, h3, p, bullet, makeTable, cellText, coverCompanyBlock, headerFooter, fs,
  diagramBox, diagramArrow, makeCover, revisionHistory,
};

import "server-only";

/**
 * Tiny dependency-free PDF writer for invoices: one A4 page, Helvetica, text, filled rects and
 * one JPEG image (the logo, embedded as a DCTDecode XObject, so no image library is needed).
 * Only WinAnsi-safe characters survive in the base-14 fonts, so text is sanitised (₹ -> "INR").
 */
type Op = string;
export class Pdf {
  ops: Op[] = [];
  private img: { w: number; h: number; data: Buffer } | null = null;
  private esc(t: string) {
    return t
      .replace(/₹/g, "INR ")
      .replace(/[–—]/g, "-")
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/[^\x20-\x7e]/g, "")
      .replace(/([\\()])/g, "\\$1");
  }
  text(x: number, y: number, t: string, size = 10, bold = false, rgb: [number, number, number] = [0.07, 0.09, 0.03]) {
    this.ops.push(`BT ${rgb.map((c) => c.toFixed(3)).join(" ")} rg /${bold ? "F2" : "F1"} ${size} Tf ${x} ${y} Td (${this.esc(t)}) Tj ET`);
  }
  /** Right-aligned using a Helvetica width estimate (good enough for numbers). */
  textR(xRight: number, y: number, t: string, size = 10, bold = false, rgb?: [number, number, number]) {
    const w = this.esc(t).length * size * (bold ? 0.56 : 0.52);
    this.text(xRight - w, y, t, size, bold, rgb);
  }
  rect(x: number, y: number, w: number, h: number, rgb: [number, number, number]) {
    this.ops.push(`${rgb.map((c) => c.toFixed(3)).join(" ")} rg ${x} ${y} ${w} ${h} re f`);
  }
  line(x1: number, y1: number, x2: number, y2: number, rgb: [number, number, number] = [0.85, 0.86, 0.82]) {
    this.ops.push(`${rgb.map((c) => c.toFixed(3)).join(" ")} RG 0.8 w ${x1} ${y1} m ${x2} ${y2} l S`);
  }
  /** Draw a baseline JPEG at (x, y) bottom-left, w x h points. One image per document. */
  jpeg(data: Buffer, px: { width: number; height: number }, x: number, y: number, w: number, h: number) {
    this.img = { w: px.width, h: px.height, data };
    this.ops.push(`q ${w} 0 0 ${h} ${x} ${y} cm /Im1 Do Q`);
  }
  build(): Buffer {
    const content = this.ops.join("\n");
    const objs = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >>${this.img ? " /XObject << /Im1 7 0 R >>" : ""} >> /Contents 6 0 R >>`,
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
      `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
    ];
    if (this.img)
      objs.push(
        `<< /Type /XObject /Subtype /Image /Width ${this.img.w} /Height ${this.img.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${this.img.data.length} >>\nstream\n${this.img.data.toString("latin1")}\nendstream`,
      );
    let out = "%PDF-1.4\n";
    const offs: number[] = [];
    objs.forEach((o, i) => {
      offs.push(Buffer.byteLength(out, "latin1"));
      out += `${i + 1} 0 obj\n${o}\nendobj\n`;
    });
    const xref = Buffer.byteLength(out, "latin1");
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("")}`;
    out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return Buffer.from(out, "latin1");
  }
}

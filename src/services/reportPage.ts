import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/** A4 at the 72 PPI coordinate system used by expo-print. */
export const A4_PRINT_WIDTH = 595;
export const A4_PRINT_HEIGHT = 842;

/**
 * WKWebView does not implement CSS paged-media counters reliably (it reports
 * every page as zero). Add the footer to the finished PDF so numbering remains
 * correct after report sections and form appendices are merged.
 */
export async function stampPdfPageFooters(
  document: PDFDocument,
  label: string,
): Promise<void> {
  const font = await document.embedFont(StandardFonts.Helvetica);
  const color = rgb(0.39, 0.45, 0.55);
  const rule = rgb(0.8, 0.85, 0.91);
  const pages = document.getPages();

  pages.forEach((page, index) => {
    const { width } = page.getSize();
    const contentScale = 0.955;
    const horizontalInset = (width - width * contentScale) / 2;
    const verticalInset = 32;
    const footerSize = 7;
    const pageLabel = `Page ${index + 1} of ${pages.length}`;
    const pageLabelWidth = font.widthOfTextAtSize(pageLabel, footerSize);
    const preTransformX = (value: number) =>
      (value - horizontalInset) / contentScale;
    const preTransformY = (value: number) =>
      (value - verticalInset) / contentScale;

    // expo-print's iOS renderer can let table rows enter the nominal @page
    // margin. Shrink the rendered content once, then move it above a real PDF
    // footer safe area, leaving room for the PDF-level footer below it.
    page.scaleContent(contentScale, contentScale);
    page.translateContent(horizontalInset, verticalInset);
    // pdf-lib appends subsequent drawing operations inside the wrapped page
    // stream. Use inverse coordinates so the footer lands at its intended
    // physical position after the content transform.
    page.drawLine({
      start: { x: preTransformX(36), y: preTransformY(28) },
      end: { x: preTransformX(width - 36), y: preTransformY(28) },
      thickness: 0.5 / contentScale,
      color: rule,
    });
    page.drawText(label, {
      x: preTransformX(36),
      y: preTransformY(14),
      size: footerSize / contentScale,
      font,
      color,
    });
    page.drawText(pageLabel, {
      x: preTransformX(width - 36 - pageLabelWidth),
      y: preTransformY(14),
      size: footerSize / contentScale,
      font,
      color,
    });
  });
}

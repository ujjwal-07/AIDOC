import { pdfjsLib, PDFJS_DEFAULT_CONFIG } from './pdfWorkerSetup';
import { Document, Paragraph, TextRun, HeadingLevel, PageBreak, Packer } from 'docx';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

export interface ExtractedPageText {
  pageNumber: number;
  headings: string[];
  paragraphs: string[];
  fullText: string;
}

export interface PdfToWordResult {
  pages: ExtractedPageText[];
  totalWords: number;
  docxBlob: Blob;
}

interface RawPdfItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  hasEOL?: boolean;
}

type HeadingLevelValue = (typeof HeadingLevel)[keyof typeof HeadingLevel];

interface StructuredLine {
  text: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
  isHeading: boolean;
  headingLevel?: HeadingLevelValue;
  isListItem: boolean;
}

/**
 * High-precision extraction of text, line flows, lists, and headings from PDF pages.
 * Accurately clusters horizontal text runs, respects 2D spatial sorting, prevents line cutting,
 * and compiles structured paragraphs into Microsoft Word (.docx).
 */
export async function convertPdfToWord(
  pdfBuffer: ArrayBuffer,
  onProgress?: (progress: number, status: string) => void
): Promise<PdfToWordResult> {
  onProgress?.(10, 'Initializing PDF parser engine...');
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(pdfBuffer),
    ...PDFJS_DEFAULT_CONFIG,
  });
  const pdfDoc = await loadingTask.promise;
  const numPages = pdfDoc.numPages;

  const docxChildren: Paragraph[] = [];
  const extractedPages: ExtractedPageText[] = [];
  let totalWords = 0;

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const progressPercent = Math.round(15 + (pageNum / numPages) * 70);
    onProgress?.(progressPercent, `Reconstructing layout for page ${pageNum} of ${numPages}...`);

    const page = await pdfDoc.getPage(pageNum);
    const textContent = await page.getTextContent();
    const rawItems: RawPdfItem[] = [];

    // 1. Ingest raw text items with precise coordinate mapping
    for (const raw of textContent.items as any[]) {
      if (!raw || typeof raw.str !== 'string') continue;
      const str = raw.str;
      if (!str && !raw.hasEOL) continue;

      const transform = raw.transform || [12, 0, 0, 12, 0, 0];
      const x = transform[4];
      const y = transform[5]; // In PDF coordinates, higher Y = higher on the page
      const fontSize = Math.round(Math.hypot(transform[0], transform[1])) || 12;
      const width = typeof raw.width === 'number' ? raw.width : (str.length * fontSize * 0.55);
      const height = typeof raw.height === 'number' && raw.height > 0 ? raw.height : fontSize;

      rawItems.push({
        str,
        x,
        y,
        width,
        height,
        fontSize,
        hasEOL: raw.hasEOL,
      });
    }

    if (rawItems.length === 0) {
      extractedPages.push({
        pageNumber: pageNum,
        headings: [],
        paragraphs: ['[Empty Page or Scanned Image Only]'],
        fullText: '',
      });
      continue;
    }

    // 2. Compute median body font size on this page for dynamic heading thresholds
    const fontSizes = rawItems.map((it) => it.fontSize).filter((fs) => fs > 0);
    fontSizes.sort((a, b) => a - b);
    const medianFontSize = fontSizes[Math.floor(fontSizes.length / 2)] || 11;

    // 3. Cluster items into visual horizontal lines
    // First, sort items roughly top-to-bottom (Y descending), then left-to-right (X ascending)
    rawItems.sort((a, b) => {
      const yDiff = b.y - a.y;
      const tolerance = Math.min(a.fontSize, b.fontSize) * 0.45;
      if (Math.abs(yDiff) <= tolerance) {
        return a.x - b.x;
      }
      return yDiff;
    });

    const lines: StructuredLine[] = [];
    let currentLineCluster: RawPdfItem[] = [];
    let currentLineBaselineY = -1;

    for (const item of rawItems) {
      if (!item.str || item.str.trim() === '') {
        // Keep spaces if they have substantial width
        if (item.width > 2 && currentLineCluster.length > 0) {
          currentLineCluster.push(item);
        }
        continue;
      }

      const clusterTolerance = Math.max(3.5, item.fontSize * 0.42);

      if (currentLineBaselineY === -1 || Math.abs(item.y - currentLineBaselineY) <= clusterTolerance) {
        currentLineCluster.push(item);
        if (currentLineBaselineY === -1) {
          currentLineBaselineY = item.y;
        }
      } else {
        if (currentLineCluster.length > 0) {
          lines.push(buildStructuredLine(currentLineCluster, medianFontSize));
        }
        currentLineCluster = [item];
        currentLineBaselineY = item.y;
      }
    }

    if (currentLineCluster.length > 0) {
      lines.push(buildStructuredLine(currentLineCluster, medianFontSize));
    }

    // Sort reconstructed lines strictly top-to-bottom
    lines.sort((a, b) => b.y - a.y);

    // 4. Calculate line gaps to detect true paragraph breaks
    const lineGaps: number[] = [];
    for (let i = 1; i < lines.length; i++) {
      const gap = lines[i - 1].y - lines[i].y;
      if (gap > 0 && gap < medianFontSize * 4) {
        lineGaps.push(gap);
      }
    }
    lineGaps.sort((a, b) => a - b);
    const medianGap = lineGaps.length > 0 ? lineGaps[Math.floor(lineGaps.length / 2)] : (medianFontSize * 1.3);

    // 5. Assemble lines into coherent paragraphs and Word blocks
    const pageHeadings: string[] = [];
    const pageParagraphs: string[] = [];
    let currentParagraphLines: string[] = [];

    const flushCurrentParagraph = () => {
      if (currentParagraphLines.length === 0) return;

      // Join lines smoothly: if line ends with hyphenation, join without space
      let paragraphText = '';
      for (let i = 0; i < currentParagraphLines.length; i++) {
        const lineStr = currentParagraphLines[i].trim();
        if (i === 0) {
          paragraphText = lineStr;
        } else {
          if (paragraphText.endsWith('-') && /^[a-z]/.test(lineStr)) {
            paragraphText = paragraphText.slice(0, -1) + lineStr;
          } else {
            paragraphText += ' ' + lineStr;
          }
        }
      }

      paragraphText = paragraphText.replace(/\s+/g, ' ').trim();
      if (paragraphText) {
        pageParagraphs.push(paragraphText);
        docxChildren.push(
          new Paragraph({
            children: [
              new TextRun({
                text: paragraphText,
                size: 23, // ~11.5pt
                font: 'Calibri',
              }),
            ],
            spacing: { after: 140, line: 276 }, // 1.15 line spacing, 7pt space after
          })
        );
      }
      currentParagraphLines = [];
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const prevLine = i > 0 ? lines[i - 1] : null;

      // Count words
      const lineWords = line.text.split(/\s+/).filter(Boolean).length;
      totalWords += lineWords;

      // Check vertical spacing indicating paragraph break
      const gapFromPrev = prevLine ? prevLine.y - line.y : 0;
      const isExtraVerticalGap = gapFromPrev > (medianGap * 1.55);

      if (line.isHeading) {
        flushCurrentParagraph();
        pageHeadings.push(line.text);
        docxChildren.push(
          new Paragraph({
            text: line.text,
            heading: line.headingLevel || HeadingLevel.HEADING_1,
            spacing: {
              before: line.headingLevel === HeadingLevel.HEADING_1 ? 260 : 180,
              after: 100,
            },
          })
        );
        continue;
      }

      if (line.isListItem) {
        flushCurrentParagraph();
        pageParagraphs.push(line.text);
        docxChildren.push(
          new Paragraph({
            children: [
              new TextRun({
                text: line.text,
                size: 23,
                font: 'Calibri',
              }),
            ],
            spacing: { after: 100, line: 260 },
            indent: { left: 400 },
          })
        );
        continue;
      }

      // If noticeable gap or previous line ended with end-of-sentence punctuation, flush
      if (isExtraVerticalGap && currentParagraphLines.length > 0) {
        flushCurrentParagraph();
      }

      currentParagraphLines.push(line.text);
    }

    flushCurrentParagraph();

    // Page break between pages (except last)
    if (pageNum < numPages) {
      docxChildren.push(
        new Paragraph({
          children: [new PageBreak()],
        })
      );
    }

    extractedPages.push({
      pageNumber: pageNum,
      headings: pageHeadings,
      paragraphs: pageParagraphs,
      fullText: pageParagraphs.join('\n\n'),
    });
  }

  onProgress?.(90, 'Packaging structured Microsoft Word (.docx) document...');

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: 'Calibri',
            size: 23,
            color: '1E293B',
          },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1440, // 1 inch
              bottom: 1440,
              left: 1440,
              right: 1440,
            },
          },
        },
        children: docxChildren.length > 0 ? docxChildren : [new Paragraph({ text: 'No text extracted' })],
      },
    ],
  });

  const docxBlob = await Packer.toBlob(doc);
  onProgress?.(100, 'Word conversion completed successfully!');

  return {
    pages: extractedPages,
    totalWords,
    docxBlob,
  };
}

/**
 * Reconstructs a single line of text from clustered items with micro-gap spacing analysis.
 */
function buildStructuredLine(items: RawPdfItem[], medianFontSize: number): StructuredLine {
  // Sort items on the line strictly left-to-right
  items.sort((a, b) => a.x - b.x);

  let text = '';
  let lineFontSize = 11;
  const minX = items[0].x;
  const baselineY = items[0].y;
  let maxX = items[0].x + items[0].width;

  for (let i = 0; i < items.length; i++) {
    const cur = items[i];
    lineFontSize = Math.max(lineFontSize, cur.fontSize);
    maxX = Math.max(maxX, cur.x + cur.width);

    if (i === 0) {
      text += cur.str;
    } else {
      const prev = items[i - 1];
      const prevEndX = prev.x + prev.width;
      const gap = cur.x - prevEndX;
      const prevChar = text.slice(-1);
      const nextChar = cur.str[0];

      // Insert space if there is a gap between fragments and neither side has whitespace
      const shouldInsertSpace =
        gap > (cur.fontSize * 0.16) &&
        !/\s/.test(prevChar) &&
        !/\s/.test(nextChar) &&
        prevChar !== '-' &&
        prevChar !== '/' &&
        nextChar !== ',' &&
        nextChar !== '.' &&
        nextChar !== ':' &&
        nextChar !== ';' &&
        nextChar !== ')' &&
        prevChar !== '(';

      if (shouldInsertSpace) {
        text += ' ' + cur.str;
      } else {
        text += cur.str;
      }
    }
  }

  const cleanText = text.replace(/\s+/g, ' ').trim();

  // Heading classification
  let isHeading = false;
  let headingLevel: HeadingLevelValue | undefined;

  if (lineFontSize >= medianFontSize * 1.45) {
    isHeading = true;
    headingLevel = HeadingLevel.HEADING_1;
  } else if (lineFontSize >= medianFontSize * 1.25 && cleanText.length < 90 && !/[.?!]$/.test(cleanText)) {
    isHeading = true;
    headingLevel = HeadingLevel.HEADING_2;
  }

  // Bullet list detection
  const isListItem =
    !isHeading &&
    /^([•\u2022\u25E6\u25AA\u25CF\u2013\u2014\-\*]|\d+[\.\)]|[a-zA-Z][\.\)])\s+/.test(cleanText);

  return {
    text: cleanText,
    x: minX,
    y: baselineY,
    width: maxX - minX,
    fontSize: lineFontSize,
    isHeading,
    headingLevel,
    isListItem,
  };
}

/**
 * Creates a rich sample PDF for quick demonstration of PDF to Word conversion
 */
export async function createSamplePdf(): Promise<Blob> {
  const pdfDoc = await PDFDocument.create();
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const page = pdfDoc.addPage([595.28, 841.89]); // A4
  const { height } = page.getSize();

  // Header
  page.drawText('PROJECT SPECIFICATION & ROADMAP', {
    x: 50,
    y: height - 60,
    size: 20,
    font: fontBold,
    color: rgb(0.1, 0.15, 0.3),
  });

  page.drawText('Document Version: 2.4 | Author: Engineering Lead | Status: Approved', {
    x: 50,
    y: height - 85,
    size: 10,
    font: fontRegular,
    color: rgb(0.4, 0.45, 0.55),
  });

  // Section 1
  page.drawText('1. Project Overview & Architecture', {
    x: 50,
    y: height - 125,
    size: 14,
    font: fontBold,
    color: rgb(0.2, 0.25, 0.4),
  });

  page.drawText(
    'This specification establishes the technical requirements for client-side document processing.',
    { x: 50, y: height - 150, size: 11, font: fontRegular, color: rgb(0.15, 0.15, 0.15) }
  );
  page.drawText(
    'All conversions, OCR text extraction, and PDF merging operate 100% locally in the browser memory,',
    { x: 50, y: height - 168, size: 11, font: fontRegular, color: rgb(0.15, 0.15, 0.15) }
  );
  page.drawText(
    'ensuring zero latency and complete data sovereignty for corporate and sensitive documents.',
    { x: 50, y: height - 186, size: 11, font: fontRegular, color: rgb(0.15, 0.15, 0.15) }
  );

  // Section 2
  page.drawText('2. Key Deliverables & Timelines', {
    x: 50,
    y: height - 230,
    size: 14,
    font: fontBold,
    color: rgb(0.2, 0.25, 0.4),
  });

  page.drawText('• Full bidirectional Word (.docx) and PDF document conversion pipeline.', {
    x: 60,
    y: height - 255,
    size: 11,
    font: fontRegular,
    color: rgb(0.15, 0.15, 0.15),
  });
  page.drawText('• High-throughput multi-document PDF merge with drag-and-drop page ordering.', {
    x: 60,
    y: height - 275,
    size: 11,
    font: fontRegular,
    color: rgb(0.15, 0.15, 0.15),
  });
  page.drawText('• Real-time interactive PDF text manipulation with automatic background patching.', {
    x: 60,
    y: height - 295,
    size: 11,
    font: fontRegular,
    color: rgb(0.15, 0.15, 0.15),
  });
  page.drawText('• Neural OCR image text detection and clean in-place text replacement.', {
    x: 60,
    y: height - 315,
    size: 11,
    font: fontRegular,
    color: rgb(0.15, 0.15, 0.15),
  });

  // Section 3
  page.drawText('3. Quality Assurance & Performance', {
    x: 50,
    y: height - 360,
    size: 14,
    font: fontBold,
    color: rgb(0.2, 0.25, 0.4),
  });

  page.drawText(
    'Automated end-to-end regression benchmarks have proven sub-second execution across modern devices.',
    { x: 50, y: height - 385, size: 11, font: fontRegular, color: rgb(0.15, 0.15, 0.15) }
  );
  page.drawText(
    'The extracted Word documents retain semantic heading tags, paragraph structures, and line flows.',
    { x: 50, y: height - 403, size: 11, font: fontRegular, color: rgb(0.15, 0.15, 0.15) }
  );

  const pdfBytes = await pdfDoc.save();
  return new Blob([pdfBytes as unknown as BlobPart], { type: 'application/pdf' });
}

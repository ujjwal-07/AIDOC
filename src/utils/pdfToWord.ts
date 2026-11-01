import { pdfjsLib } from './pdfWorkerSetup';
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

/**
 * Extracts text and structural paragraphs from a PDF using pdfjs-dist,
 * then packages it into a properly formatted Microsoft Word (.docx) document.
 */
export async function convertPdfToWord(
  pdfBuffer: ArrayBuffer,
  onProgress?: (progress: number, status: string) => void
): Promise<PdfToWordResult> {
  onProgress?.(10, 'Loading PDF document...');
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(pdfBuffer) });
  const pdfDoc = await loadingTask.promise;
  const numPages = pdfDoc.numPages;

  const docxChildren: Paragraph[] = [];
  const extractedPages: ExtractedPageText[] = [];
  let totalWords = 0;

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const progressPercent = Math.round(15 + (pageNum / numPages) * 70);
    onProgress?.(progressPercent, `Extracting text and layout from page ${pageNum} of ${numPages}...`);

    const page = await pdfDoc.getPage(pageNum);
    const textContent = await page.getTextContent();
    const items = textContent.items as Array<{
      str: string;
      transform: number[];
      width: number;
      height: number;
      hasEOL?: boolean;
    }>;

    // Group text items into lines and detect headings based on Y coordinate and font size
    const lines: Array<{ text: string; fontSize: number; y: number }> = [];
    let currentLine = '';
    let currentLineY = -1;
    let maxFontSizeInLine = 12;

    for (const item of items) {
      if (!item.str) continue;

      const y = Math.round(item.transform[5]);
      const fontSize = Math.round(Math.abs(item.transform[0]) || Math.abs(item.transform[3]) || 12);

      if (currentLineY === -1 || Math.abs(y - currentLineY) < 6) {
        currentLine += (currentLine ? ' ' : '') + item.str;
        maxFontSizeInLine = Math.max(maxFontSizeInLine, fontSize);
        currentLineY = y;
      } else {
        if (currentLine.trim()) {
          lines.push({
            text: currentLine.trim(),
            fontSize: maxFontSizeInLine,
            y: currentLineY,
          });
        }
        currentLine = item.str;
        currentLineY = y;
        maxFontSizeInLine = fontSize;
      }
    }

    if (currentLine.trim()) {
      lines.push({
        text: currentLine.trim(),
        fontSize: maxFontSizeInLine,
        y: currentLineY,
      });
    }

    const pageHeadings: string[] = [];
    const pageParagraphs: string[] = [];
    let currentParagraphBuffer: string[] = [];

    const flushParagraph = () => {
      if (currentParagraphBuffer.length > 0) {
        const paraText = currentParagraphBuffer.join(' ').replace(/\s+/g, ' ').trim();
        if (paraText) {
          pageParagraphs.push(paraText);
          docxChildren.push(
            new Paragraph({
              children: [new TextRun({ text: paraText, size: 24 })], // 12pt
              spacing: { after: 180 },
            })
          );
        }
        currentParagraphBuffer = [];
      }
    };

    for (const line of lines) {
      const text = line.text;
      const words = text.split(/\s+/).filter(Boolean).length;
      totalWords += words;

      // Classify as heading if font is significantly larger or short emphatic line
      if (line.fontSize >= 18) {
        flushParagraph();
        pageHeadings.push(text);
        docxChildren.push(
          new Paragraph({
            text: text,
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 240, after: 120 },
          })
        );
      } else if (line.fontSize >= 14) {
        flushParagraph();
        pageHeadings.push(text);
        docxChildren.push(
          new Paragraph({
            text: text,
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 180, after: 90 },
          })
        );
      } else {
        currentParagraphBuffer.push(text);
      }
    }

    flushParagraph();

    // Add page break if not last page
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
    sections: [
      {
        properties: {},
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

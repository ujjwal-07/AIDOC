import mammoth from 'mammoth';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { Document, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle, Packer } from 'docx';

export interface DocxConversionResult {
  html: string;
  rawText: string;
  messages: string[];
}

/**
 * Converts a Word (.docx) file ArrayBuffer into styled HTML and raw text
 */
export async function convertDocxToHtml(arrayBuffer: ArrayBuffer): Promise<DocxConversionResult> {
  const result = await mammoth.convertToHtml({ arrayBuffer });
  const rawTextResult = await mammoth.extractRawText({ arrayBuffer });

  return {
    html: result.value,
    rawText: rawTextResult.value,
    messages: result.messages.map((m) => m.message),
  };
}

/**
 * Converts an HTML element preview into a downloadable high-resolution PDF Blob
 */
export async function exportHtmlToPdf(
  element: HTMLElement,
  options: {
    title?: string;
    pageSize?: 'a4' | 'letter';
    orientation?: 'portrait' | 'landscape';
    margins?: number;
  } = {}
): Promise<Blob> {
  const { pageSize = 'a4', orientation = 'portrait', margins = 12 } = options;

  // High DPI rendering of the document preview
  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    logging: false,
    backgroundColor: '#ffffff',
  });

  const pdf = new jsPDF({
    orientation,
    unit: 'mm',
    format: pageSize,
  });

  const pdfWidth = pdf.internal.pageSize.getWidth();
  const pdfHeight = pdf.internal.pageSize.getHeight();
  const printWidth = pdfWidth - margins * 2;
  const printHeight = (canvas.height * printWidth) / canvas.width;

  const pageContentHeight = pdfHeight - margins * 2;
  const totalPages = Math.ceil(printHeight / pageContentHeight);

  // Split canvas into multi-page PDF slices cleanly
  for (let i = 0; i < totalPages; i++) {
    if (i > 0) {
      pdf.addPage();
    }

    const sourceY = (i * canvas.height) / totalPages;
    const sourceHeight = canvas.height / totalPages;

    const sliceCanvas = document.createElement('canvas');
    sliceCanvas.width = canvas.width;
    sliceCanvas.height = sourceHeight;
    const ctx = sliceCanvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
      ctx.drawImage(
        canvas,
        0,
        sourceY,
        canvas.width,
        sourceHeight,
        0,
        0,
        sliceCanvas.width,
        sourceHeight
      );
    }

    const imgData = sliceCanvas.toDataURL('image/jpeg', 0.95);
    pdf.addImage(imgData, 'JPEG', margins, margins, printWidth, pageContentHeight);
  }

  return pdf.output('blob');
}

/**
 * Converts edited HTML content into a downloadable Microsoft Word (.docx) document
 */
export async function exportHtmlToDocx(element: HTMLElement): Promise<Blob> {
  const paragraphs: Paragraph[] = [];
  const nodes = element.querySelectorAll('h1, h2, h3, p, li, blockquote');

  if (nodes.length === 0) {
    const rawLines = element.innerText.split('\n').filter((l) => l.trim().length > 0);
    rawLines.forEach((line) => {
      paragraphs.push(new Paragraph({ text: line, spacing: { after: 140 } }));
    });
  } else {
    nodes.forEach((node) => {
      const text = node.textContent?.trim() || '';
      if (!text) return;

      const tagName = node.tagName.toLowerCase();
      if (tagName === 'h1') {
        paragraphs.push(new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 120 } }));
      } else if (tagName === 'h2') {
        paragraphs.push(new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 180, after: 90 } }));
      } else if (tagName === 'h3') {
        paragraphs.push(new Paragraph({ text, heading: HeadingLevel.HEADING_3, spacing: { before: 140, after: 70 } }));
      } else {
        paragraphs.push(new Paragraph({ children: [new TextRun({ text, size: 24 })], spacing: { after: 140 } }));
      }
    });
  }

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: paragraphs.length > 0 ? paragraphs : [new Paragraph({ text: 'Edited Document' })],
      },
    ],
  });

  return Packer.toBlob(doc);
}

/**
 * Creates a rich sample Word document (.docx) for immediate testing
 */
export async function createSampleDocx(): Promise<Blob> {
  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            text: 'Quarterly Executive Business Report',
            heading: HeadingLevel.TITLE,
            spacing: { after: 200 },
          }),
          new Paragraph({
            text: 'Prepared by DocuCraft Enterprise Solutions | Confidential',
            spacing: { after: 300 },
          }),
          new Paragraph({
            text: '1. Executive Summary',
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 200, after: 120 },
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: 'During the past quarter, our cloud document operations delivered an outstanding ',
              }),
              new TextRun({
                text: '99.98% conversion success rate',
                bold: true,
              }),
              new TextRun({
                text: ' across over 450,000 PDF and Word document workflows. User retention reached an all-time high of 94.2%.',
              }),
            ],
            spacing: { after: 200 },
          }),
          new Paragraph({
            text: '2. Performance Metrics & Analytics',
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 200, after: 120 },
          }),
          new Table({
            width: {
              size: 100,
              type: WidthType.PERCENTAGE,
            },
            rows: [
              new TableRow({
                children: [
                  new TableCell({
                    children: [new Paragraph({ children: [new TextRun({ text: 'Workflow Type', bold: true })] })],
                    borders: { bottom: { style: BorderStyle.SINGLE, size: 1, color: '888888' } },
                  }),
                  new TableCell({
                    children: [new Paragraph({ children: [new TextRun({ text: 'Processing Speed', bold: true })] })],
                    borders: { bottom: { style: BorderStyle.SINGLE, size: 1, color: '888888' } },
                  }),
                  new TableCell({
                    children: [new Paragraph({ children: [new TextRun({ text: 'Fidelity Score', bold: true })] })],
                    borders: { bottom: { style: BorderStyle.SINGLE, size: 1, color: '888888' } },
                  }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ text: 'Word to PDF' })] }),
                  new TableCell({ children: [new Paragraph({ text: '0.45 seconds' })] }),
                  new TableCell({ children: [new Paragraph({ text: '99.8%' })] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ text: 'PDF to Word' })] }),
                  new TableCell({ children: [new Paragraph({ text: '0.62 seconds' })] }),
                  new TableCell({ children: [new Paragraph({ text: '98.5%' })] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ text: 'Multi-Document Merge' })] }),
                  new TableCell({ children: [new Paragraph({ text: '0.31 seconds' })] }),
                  new TableCell({ children: [new Paragraph({ text: '100%' })] }),
                ],
              }),
            ],
          }),
          new Paragraph({
            text: '3. Strategic Recommendations',
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 280, after: 120 },
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: '• Automate OCR vector extraction for scanned contracts and enterprise invoices.\n',
              }),
              new TextRun({
                text: '• Deploy client-side multi-threaded document parsing to guarantee 100% data privacy.\n',
              }),
              new TextRun({
                text: '• Enable direct in-line PDF text manipulation without needing expensive desktop editors.',
              }),
            ],
            spacing: { after: 300 },
          }),
        ],
      },
    ],
  });

  return Packer.toBlob(doc);
}

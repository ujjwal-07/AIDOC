import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { convertDocxToHtml, exportHtmlToPdf } from './wordToPdf';

export interface MergeDocumentItem {
  id: string;
  file: File;
  name: string;
  size: number;
  type: string;
  pageCount?: number;
  previewUrl?: string;
}

export interface MergeOptions {
  outputFileName?: string;
  addPageNumbers?: boolean;
  addCoverPage?: boolean;
  coverTitle?: string;
  coverSubtitle?: string;
}

/**
 * Merges multiple documents (PDFs, Images, Word docs) into a single unified master PDF
 */
export async function mergeDocuments(
  items: MergeDocumentItem[],
  options: MergeOptions = {},
  onProgress?: (progress: number, status: string) => void
): Promise<Blob> {
  if (items.length === 0) {
    throw new Error('Please select at least one document to merge.');
  }

  onProgress?.(5, 'Initializing Master PDF Document...');
  const mergedPdf = await PDFDocument.create();
  const fontRegular = await mergedPdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await mergedPdf.embedFont(StandardFonts.HelveticaBold);

  // Optional Cover Page
  if (options.addCoverPage) {
    onProgress?.(10, 'Creating Table of Contents & Cover Page...');
    const coverPage = mergedPdf.addPage([595.28, 841.89]); // A4
    const { width, height } = coverPage.getSize();

    // Decorative gradient banner
    coverPage.drawRectangle({
      x: 0,
      y: height - 180,
      width: width,
      height: 180,
      color: rgb(0.12, 0.16, 0.28),
    });

    coverPage.drawText(options.coverTitle || 'Consolidated Document Master', {
      x: 50,
      y: height - 90,
      size: 24,
      font: fontBold,
      color: rgb(1, 1, 1),
    });

    coverPage.drawText(
      options.coverSubtitle || `Compiled on ${new Date().toLocaleDateString()} | Total Documents: ${items.length}`,
      {
        x: 50,
        y: height - 125,
        size: 11,
        font: fontRegular,
        color: rgb(0.7, 0.75, 0.9),
      }
    );

    // Document index list
    coverPage.drawText('Table of Contents', {
      x: 50,
      y: height - 230,
      size: 16,
      font: fontBold,
      color: rgb(0.2, 0.25, 0.35),
    });

    let currentY = height - 265;
    items.forEach((item, idx) => {
      coverPage.drawText(`${idx + 1}.`, {
        x: 50,
        y: currentY,
        size: 11,
        font: fontBold,
        color: rgb(0.39, 0.4, 0.95), // Indigo
      });
      coverPage.drawText(item.name, {
        x: 75,
        y: currentY,
        size: 11,
        font: fontRegular,
        color: rgb(0.15, 0.15, 0.2),
      });
      coverPage.drawText(`${(item.size / 1024).toFixed(1)} KB`, {
        x: width - 110,
        y: currentY,
        size: 10,
        font: fontRegular,
        color: rgb(0.5, 0.55, 0.6),
      });
      currentY -= 26;
    });
  }

  // Iterate over files and merge
  const totalItems = items.length;
  for (let i = 0; i < totalItems; i++) {
    const item = items[i];
    const progressBase = Math.round(15 + ((i) / totalItems) * 75);
    onProgress?.(progressBase, `Merging [${i + 1}/${totalItems}]: ${item.name}...`);

    const file = item.file;
    const arrayBuffer = await file.arrayBuffer();

    if (file.type === 'application/pdf' || item.name.toLowerCase().endsWith('.pdf')) {
      const srcPdf = await PDFDocument.load(arrayBuffer);
      const copiedPages = await mergedPdf.copyPages(srcPdf, srcPdf.getPageIndices());
      copiedPages.forEach((page) => mergedPdf.addPage(page));
    } else if (file.type.startsWith('image/')) {
      // Embed Image into new A4 page
      const page = mergedPdf.addPage([595.28, 841.89]);
      const { width, height } = page.getSize();
      const margin = 36;
      const maxWidth = width - margin * 2;
      const maxHeight = height - margin * 2;

      let embeddedImage;
      if (file.type === 'image/jpeg' || item.name.toLowerCase().endsWith('.jpg') || item.name.toLowerCase().endsWith('.jpeg')) {
        embeddedImage = await mergedPdf.embedJpg(arrayBuffer);
      } else {
        embeddedImage = await mergedPdf.embedPng(arrayBuffer);
      }

      const imgDims = embeddedImage.scaleToFit(maxWidth, maxHeight);
      page.drawImage(embeddedImage, {
        x: (width - imgDims.width) / 2,
        y: (height - imgDims.height) / 2,
        width: imgDims.width,
        height: imgDims.height,
      });
    } else if (
      file.type.includes('word') ||
      item.name.toLowerCase().endsWith('.docx') ||
      item.name.toLowerCase().endsWith('.doc')
    ) {
      // Convert Word document to PDF first
      onProgress?.(progressBase + 2, `Converting ${item.name} to PDF before merge...`);
      const { html } = await convertDocxToHtml(arrayBuffer);
      const tempContainer = document.createElement('div');
      tempContainer.style.position = 'absolute';
      tempContainer.style.left = '-9999px';
      tempContainer.style.top = '-9999px';
      tempContainer.style.width = '800px';
      tempContainer.style.padding = '40px';
      tempContainer.style.backgroundColor = '#ffffff';
      tempContainer.style.color = '#000000';
      tempContainer.innerHTML = html;
      document.body.appendChild(tempContainer);

      try {
        const docxPdfBlob = await exportHtmlToPdf(tempContainer);
        const docxPdfBytes = await docxPdfBlob.arrayBuffer();
        const docxPdfDoc = await PDFDocument.load(docxPdfBytes);
        const copiedPages = await mergedPdf.copyPages(docxPdfDoc, docxPdfDoc.getPageIndices());
        copiedPages.forEach((page) => mergedPdf.addPage(page));
      } finally {
        document.body.removeChild(tempContainer);
      }
    }
  }

  // Add page numbers if requested
  if (options.addPageNumbers) {
    onProgress?.(92, 'Applying standardized page numbers...');
    const pages = mergedPdf.getPages();
    const totalPages = pages.length;
    for (let idx = 0; idx < totalPages; idx++) {
      const page = pages[idx];
      const { width } = page.getSize();
      const pageNumberText = `Page ${idx + 1} of ${totalPages}`;
      const textWidth = fontRegular.widthOfTextAtSize(pageNumberText, 9);
      page.drawText(pageNumberText, {
        x: (width - textWidth) / 2,
        y: 18,
        size: 9,
        font: fontRegular,
        color: rgb(0.4, 0.45, 0.5),
      });
    }
  }

  onProgress?.(98, 'Finalizing combined PDF document...');
  const mergedPdfBytes = await mergedPdf.save();
  onProgress?.(100, 'Merge completed successfully!');

  return new Blob([mergedPdfBytes as unknown as BlobPart], { type: 'application/pdf' });
}

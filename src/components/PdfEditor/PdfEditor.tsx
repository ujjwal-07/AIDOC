import React, { useState, useRef, useEffect, useMemo } from 'react';
import { 
  Edit3, 
  Type, 
  Eraser, 
  Highlighter, 
  Download, 
  ZoomIn, 
  ZoomOut, 
  ChevronLeft, 
  ChevronRight, 
  CheckCircle2, 
  Trash2, 
  Move, 
  FileText, 
  Search, 
  X, 
  Check, 
  RefreshCw,
  ShieldCheck,
  AlertTriangle
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { pdfjsLib } from '../../utils/pdfWorkerSetup';
import { createSamplePdf } from '../../utils/pdfToWord';
import jsPDF from 'jspdf';

interface TextOverlayItem {
  id: string;
  page: number;
  x: number;
  y: number;
  originalWidth: number;
  width: number;
  height: number;
  text: string;
  fontSize: number;
  fontFamily: string;
  color: string;
  isBold: boolean;
  isItalic: boolean;
  backgroundColor: string;
  autoFit: boolean;
  yOffset: number;
  extraRightPad?: number;
  isRedaction?: boolean;
  isHighlight?: boolean;
}

interface DetectedTextItem {
  id: string;
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontFamily: string;
  fontName: string;
  isBold: boolean;
  isItalic: boolean;
  textColor: string;
  bgColor: string;
}

/**
 * Intelligently merges adjacent PDF text fragments/glyphs into full words or coherent sentences
 */
function groupAndMergeTextItems(
  items: DetectedTextItem[],
  mode: 'line' | 'word'
): DetectedTextItem[] {
  if (items.length <= 1) return items;

  // Sort top-to-bottom, left-to-right
  const sorted = [...items].sort((a, b) => {
    if (Math.abs(a.y - b.y) > 4) {
      return a.y - b.y;
    }
    return a.x - b.x;
  });

  const merged: DetectedTextItem[] = [];
  let current: DetectedTextItem = { ...sorted[0] };

  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i];

    const sameLine = Math.abs(current.y - next.y) <= Math.max(4, current.height * 0.35);
    const sameFont = Math.abs(current.fontSize - next.fontSize) <= 3;
    const horizontalGap = next.x - (current.x + current.width);

    // In 'line' mode: merge contiguous words across whitespace (gap up to font size * 0.85)
    // In 'word' mode: ONLY merge syllables/ligatures that belong to the SAME word (gap <= 2.5px)
    const maxGap = mode === 'line'
      ? Math.max(16, current.fontSize * 0.85)
      : 2.5;

    const shouldMerge = sameLine && sameFont && horizontalGap >= -5 && horizontalGap <= maxGap;

    if (shouldMerge) {
      // If gap is greater than 2.5px, it's a word separator so insert a space if not already present
      const needsSpace = horizontalGap > 2.5 && !current.str.endsWith(' ') && !next.str.startsWith(' ');
      const glue = needsSpace ? ' ' : '';
      current.str = current.str + glue + next.str;
      current.width = Math.max(current.width, (next.x + next.width) - current.x);
      current.height = Math.max(current.height, next.height);
    } else {
      merged.push(current);
      current = { ...next };
    }
  }
  merged.push(current);

  return merged;
}

/**
 * Analyzes fontName and textContent.styles to detect font family, bold, and italic
 */
function parsePdfFont(
  fontName: string,
  styleFamily?: string
): { fontFamily: string; isBold: boolean; isItalic: boolean } {
  const combined = `${fontName || ''} ${styleFamily || ''}`.toLowerCase();

  const isBold =
    combined.includes('bold') ||
    combined.includes('black') ||
    combined.includes('heavy') ||
    combined.includes('w7') ||
    combined.includes('w8') ||
    combined.includes('semibold');

  const isItalic =
    combined.includes('italic') ||
    combined.includes('oblique') ||
    combined.includes('slanted');

  let fontFamily = "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif";

  // CRITICAL: Check 'sans' / 'arial' / 'calibri' / 'helvetica' BEFORE 'serif'
  // because the string 'sans-serif' contains 'serif' as a substring!
  if (
    combined.includes('sans') ||
    combined.includes('arial') ||
    combined.includes('helvetica') ||
    combined.includes('sf pro') ||
    combined.includes('roboto') ||
    combined.includes('inter')
  ) {
    fontFamily = "Arial, Helvetica, sans-serif";
  } else if (combined.includes('calibri')) {
    fontFamily = "Calibri, Arial, sans-serif";
  } else if (
    combined.includes('times') ||
    combined.includes('georgia') ||
    combined.includes('cambria') ||
    combined.includes('garamond') ||
    (combined.includes('serif') && !combined.includes('sans'))
  ) {
    fontFamily = "'Times New Roman', Georgia, serif";
  } else if (
    combined.includes('courier') ||
    combined.includes('mono') ||
    combined.includes('consolas') ||
    combined.includes('menlo')
  ) {
    fontFamily = "'JetBrains Mono', 'Courier New', monospace";
  }

  return { fontFamily, isBold, isItalic };
}

/**
 * Samples exact text color and surrounding background color from rendered canvas
 */
function sampleTextAndBgColor(
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
  width: number,
  height: number
): { textColor: string; bgColor: string } {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { textColor: '#0f172a', bgColor: '#ffffff' };

  try {
    const clampedX = Math.max(0, Math.floor(x));
    const clampedY = Math.max(0, Math.floor(y));
    const clampedW = Math.max(1, Math.min(Math.floor(width), canvas.width - clampedX));
    const clampedH = Math.max(1, Math.min(Math.floor(height), canvas.height - clampedY));

    const imgData = ctx.getImageData(clampedX, clampedY, clampedW, clampedH).data;

    // Sample background from corner pixels
    const bgR = imgData[0];
    const bgG = imgData[1];
    const bgB = imgData[2];
    const bgColor = `rgb(${bgR}, ${bgG}, ${bgB})`;

    // Find darkest pixel for text color (highest contrast)
    let minBrightness = 765;
    let textR = 30, textG = 41, textB = 59;

    for (let i = 0; i < imgData.length; i += 4) {
      const r = imgData[i];
      const g = imgData[i + 1];
      const b = imgData[i + 2];
      const a = imgData[i + 3];
      if (a > 120) {
        const brightness = r + g + b;
        if (brightness < minBrightness) {
          minBrightness = brightness;
          textR = r;
          textG = g;
          textB = b;
        }
      }
    }

    return {
      textColor: `rgb(${textR}, ${textG}, ${textB})`,
      bgColor: minBrightness > 650 ? '#ffffff' : bgColor,
    };
  } catch {
    return { textColor: '#0f172a', bgColor: '#ffffff' };
  }
}

/**
 * Computes exact text layout, checking if text fits inside slot and auto-scaling font size to prevent overlapping
 */
function computeTextLayout(
  text: string,
  fontSize: number,
  fontFamily: string,
  isBold: boolean,
  isItalic: boolean,
  originalWidth: number,
  autoFit: boolean
): { fittedFontSize: number; measuredWidth: number; isScaled: boolean } {
  const testCanvas = document.createElement('canvas');
  const testCtx = testCanvas.getContext('2d');
  if (!testCtx) return { fittedFontSize: fontSize, measuredWidth: originalWidth, isScaled: false };

  const fontStr = (size: number) =>
    `${isItalic ? 'italic ' : ''}${isBold ? 'bold ' : ''}${size}px ${fontFamily}`;

  testCtx.font = fontStr(fontSize);
  let measured = testCtx.measureText(text).width;

  if (autoFit && originalWidth > 0 && measured > originalWidth) {
    const ratio = Math.max(0.4, (originalWidth - 1) / measured);
    const fitted = Math.max(7, Number((fontSize * ratio).toFixed(1)));
    testCtx.font = fontStr(fitted);
    measured = testCtx.measureText(text).width;
    return { fittedFontSize: fitted, measuredWidth: measured, isScaled: true };
  }

  return { fittedFontSize: fontSize, measuredWidth: measured, isScaled: false };
}

export const PdfEditor: React.FC = () => {
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [zoomScale, setZoomScale] = useState(() => {
    if (typeof window !== 'undefined' && window.innerWidth <= 768) {
      return Math.max(0.5, Number(((window.innerWidth - 32) / 600).toFixed(2)));
    }
    return 1.2;
  });
  const [isLoadingPdf, setIsLoadingPdf] = useState(false);

  // Active Tool: 'editText' | 'addText' | 'whiteout' | 'highlight' | 'select'
  const [activeTool, setActiveTool] = useState<'editText' | 'addText' | 'whiteout' | 'highlight' | 'select'>('editText');

  // Text formatting controls
  const [fontFamily, setFontFamily] = useState("'Plus Jakarta Sans', system-ui, -apple-system, sans-serif");
  const [fontSize, setFontSize] = useState(14);
  const [textColor, setTextColor] = useState('#0f172a');
  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);

  // Overlays / edits made to the document
  const [overlays, setOverlays] = useState<TextOverlayItem[]>([]);
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  // Detected text boxes for current page
  const [pageTextItems, setPageTextItems] = useState<DetectedTextItem[]>([]);
  const [rawPageTextItems, setRawPageTextItems] = useState<DetectedTextItem[]>([]);
  const [textGranularity, setTextGranularity] = useState<'line' | 'word'>('line');
  const [hoveredTextId, setHoveredTextId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showTextBoundingBoxes, setShowTextBoundingBoxes] = useState(true);

  // In-Place Floating / Modal Text Editor
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [targetItemToEdit, setTargetItemToEdit] = useState<DetectedTextItem | null>(null);
  const [editingOverlayId, setEditingOverlayId] = useState<string | null>(null);
  const [replacementTextInput, setReplacementTextInput] = useState('');
  const [modalFontSize, setModalFontSize] = useState(14);
  const [modalFontFamily, setModalFontFamily] = useState('sans-serif');
  const [modalTextColor, setModalTextColor] = useState('#0f172a');
  const [modalBgColor, setModalBgColor] = useState('#ffffff');
  const [modalIsBold, setModalIsBold] = useState(false);
  const [modalIsItalic, setModalIsItalic] = useState(false);
  const [modalAutoFit, setModalAutoFit] = useState(true);
  const [modalYOffset, setModalYOffset] = useState(0);
  const [modalExtraRightPad, setModalExtraRightPad] = useState(0);

  const [isNewTextModal, setIsNewTextModal] = useState(false);
  const [newTextCoords, setNewTextCoords] = useState({ x: 50, y: 50 });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);

  // ---------------------------------------------------------------------------
  // Load PDF directly onto Canvas (preserves 100% original layout & design)
  // ---------------------------------------------------------------------------
  const handleLoadPdf = async (file: File) => {
    setPdfFile(file);
    setIsLoadingPdf(true);
    setOverlays([]);
    setCurrentPage(1);

    try {
      const buffer = await file.arrayBuffer();
      const rawBytes = new Uint8Array(buffer);
      const loadingTask = pdfjsLib.getDocument({ data: rawBytes });
      const doc = await loadingTask.promise;
      setPdfDoc(doc);
      setTotalPages(doc.numPages);
    } catch (err) {
      console.error('Failed to load PDF in editor:', err);
      alert('Could not render PDF. Please ensure it is a valid PDF document.');
    } finally {
      setIsLoadingPdf(false);
    }
  };

  // Quick load sample PDF
  const handleLoadSample = async () => {
    setIsLoadingPdf(true);
    try {
      const sampleBlob = await createSamplePdf();
      const sampleFile = new File([sampleBlob], 'Project_Roadmap_Contract.pdf', { type: 'application/pdf' });
      await handleLoadPdf(sampleFile);
    } finally {
      setIsLoadingPdf(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Render Current Page onto High-Resolution Canvas with Auto-Font Analysis
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!pdfDoc) return;

    let isCancelled = false;

    const renderPage = async () => {
      try {
        const page = await pdfDoc.getPage(currentPage);
        const viewport = page.getViewport({ scale: zoomScale });

        const canvas = canvasRef.current;
        const overlayCanvas = overlayCanvasRef.current;
        if (!canvas || !overlayCanvas) return;

        canvas.width = viewport.width;
        canvas.height = viewport.height;
        overlayCanvas.width = viewport.width;
        overlayCanvas.height = viewport.height;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Render base PDF page with 100% visual fidelity
        await page.render({ canvasContext: ctx, viewport }).promise;

        // Extract text items with exact styles and font information
        const textContent = await page.getTextContent();
        if (isCancelled) return;

        const styles = (textContent.styles || {}) as Record<string, { fontFamily?: string }>;
        const detected: DetectedTextItem[] = [];
        let index = 0;

        for (const item of textContent.items as any[]) {
          if (!item.str || !item.str.trim()) continue;

          const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
          const fontHeight = Math.sqrt(tx[2] * tx[2] + tx[3] * tx[3]);
          const x = tx[4];
          const y = tx[5] - fontHeight;
          const width = Math.max(item.width * (viewport.width / page.view[2]), 12);
          const height = fontHeight * 1.18;

          // Parse font styles from PDF metadata
          const fontStyleObj = styles[item.fontName] || {};
          const parsed = parsePdfFont(item.fontName, fontStyleObj.fontFamily);

          // Sample exact pixel color from the base canvas
          const sampledColors = sampleTextAndBgColor(canvas, x, y, width, height);

          detected.push({
            id: `text-item-${currentPage}-${index++}`,
            str: item.str,
            x,
            y,
            width,
            height,
            fontSize: Math.round(fontHeight),
            fontFamily: parsed.fontFamily,
            fontName: item.fontName || '',
            isBold: parsed.isBold,
            isItalic: parsed.isItalic,
            textColor: sampledColors.textColor,
            bgColor: sampledColors.bgColor,
          });
        }

        setRawPageTextItems(detected);
        const merged = groupAndMergeTextItems(detected, textGranularity);
        setPageTextItems(merged);
      } catch (err) {
        console.error('Page render error:', err);
      }
    };

    renderPage();

    return () => {
      isCancelled = true;
    };
  }, [pdfDoc, currentPage, zoomScale]);

  // Re-group text items whenever user toggles granularity ('line' vs 'word')
  useEffect(() => {
    if (rawPageTextItems.length > 0) {
      const merged = groupAndMergeTextItems(rawPageTextItems, textGranularity);
      setPageTextItems(merged);
    }
  }, [textGranularity, rawPageTextItems]);

  // ---------------------------------------------------------------------------
  // Redraw Interactive Overlay Canvas (Highlights, Edits, Non-Overlapping Patches)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 1. Draw subtle interactive bounding boxes over all detected text on the PDF
    if (showTextBoundingBoxes && (activeTool === 'editText' || activeTool === 'select')) {
      for (const t of pageTextItems) {
        const isHovered = hoveredTextId === t.id;
        ctx.fillStyle = isHovered ? 'rgba(99, 102, 241, 0.22)' : 'rgba(99, 102, 241, 0.08)';
        ctx.fillRect(t.x - 1, t.y - 1, t.width + 2, t.height + 2);

        ctx.strokeStyle = isHovered ? '#6366f1' : 'rgba(99, 102, 241, 0.35)';
        ctx.lineWidth = isHovered ? 2 : 1;
        ctx.strokeRect(t.x - 1, t.y - 1, t.width + 2, t.height + 2);
      }
    }

    // 2. Render user modifications & text replacements
    const pageOverlays = overlays.filter((item) => item.page === currentPage);
    for (const item of pageOverlays) {
      if (item.isRedaction) {
        ctx.fillStyle = item.backgroundColor || '#ffffff';
        ctx.fillRect(item.x, item.y, item.width, item.height);
        ctx.strokeStyle = 'rgba(0,0,0,0.15)';
        ctx.strokeRect(item.x, item.y, item.width, item.height);
      } else if (item.isHighlight) {
        ctx.fillStyle = item.backgroundColor || 'rgba(253, 224, 71, 0.45)';
        ctx.fillRect(item.x, item.y, item.width, item.height);
      } else {
        // Calculate auto-fitted font size to prevent overlapping adjacent words
        const layout = computeTextLayout(
          item.text,
          item.fontSize,
          item.fontFamily,
          item.isBold,
          item.isItalic,
          item.originalWidth,
          item.autoFit
        );

        // Draw background mask: covers original text space plus any extra right padding
        if (item.backgroundColor) {
          ctx.fillStyle = item.backgroundColor;
          const extraRight = item.extraRightPad || 0;
          const maskWidth =
            (item.autoFit
              ? Math.max(item.originalWidth, layout.measuredWidth)
              : Math.max(item.width, layout.measuredWidth)) + extraRight;
          // Clean 2px padding so underlying characters never peek out
          ctx.fillRect(item.x - 2, item.y - 1, maskWidth + 4, item.height + 2);
        }

        // Render text with matching baseline and fitted size
        ctx.fillStyle = item.color;
        const fontStyle = `${item.isItalic ? 'italic ' : ''}${item.isBold ? 'bold ' : ''}${layout.fittedFontSize}px ${item.fontFamily}`;
        ctx.font = fontStyle;
        ctx.textBaseline = 'top';
        ctx.fillText(item.text, item.x, item.y + (item.yOffset || 0));

        // Highlight selection border if active
        if (selectedOverlayId === item.id) {
          ctx.strokeStyle = '#6366f1';
          ctx.lineWidth = 2;
          ctx.setLineDash([4, 4]);
          const extraRight = item.extraRightPad || 0;
          ctx.strokeRect(item.x - 3, item.y - 2, layout.measuredWidth + extraRight + 6, item.height + 4);
          ctx.setLineDash([]);
        }
      }
    }
  }, [overlays, currentPage, selectedOverlayId, activeTool, pageTextItems, hoveredTextId, showTextBoundingBoxes]);

  // Open edit modal for an existing detected text item with auto-matched font & color
  const openEditModalFor = (item: DetectedTextItem) => {
    setTargetItemToEdit(item);
    setEditingOverlayId(null);
    setReplacementTextInput(item.str);
    setModalFontSize(item.fontSize);
    setModalFontFamily(item.fontFamily);
    setModalTextColor(item.textColor);
    setModalBgColor(item.bgColor);
    setModalIsBold(item.isBold);
    setModalIsItalic(item.isItalic);
    setModalAutoFit(true);
    setModalYOffset(0);
    setModalExtraRightPad(0);
    setIsNewTextModal(false);
    setEditModalOpen(true);
  };

  // Open edit modal for an already applied overlay to tweak text, styles, or mask width
  const openEditModalForOverlay = (overlay: TextOverlayItem) => {
    setEditingOverlayId(overlay.id);
    setTargetItemToEdit(null);
    setReplacementTextInput(overlay.text);
    setModalFontSize(overlay.fontSize);
    setModalFontFamily(overlay.fontFamily);
    setModalTextColor(overlay.color);
    setModalBgColor(overlay.backgroundColor);
    setModalIsBold(overlay.isBold);
    setModalIsItalic(overlay.isItalic);
    setModalAutoFit(overlay.autoFit);
    setModalYOffset(overlay.yOffset || 0);
    setModalExtraRightPad(overlay.extraRightPad || 0);
    setIsNewTextModal(false);
    setEditModalOpen(true);
  };

  // Open modal for inserting new text
  const openNewTextModalAt = (x: number, y: number) => {
    setTargetItemToEdit(null);
    setEditingOverlayId(null);
    setReplacementTextInput('');
    setModalFontSize(fontSize);
    setModalFontFamily(fontFamily);
    setModalTextColor(textColor);
    setModalBgColor('transparent');
    setModalIsBold(isBold);
    setModalIsItalic(isItalic);
    setModalAutoFit(false);
    setModalYOffset(0);
    setModalExtraRightPad(0);
    setIsNewTextModal(true);
    setNewTextCoords({ x, y });
    setEditModalOpen(true);
  };

  // Apply edit from modal
  const handleApplyModalEdit = () => {
    if (!replacementTextInput.trim()) {
      setEditModalOpen(false);
      return;
    }

    if (isNewTextModal) {
      // Add new text box
      const layout = computeTextLayout(
        replacementTextInput.trim(),
        modalFontSize,
        modalFontFamily,
        modalIsBold,
        modalIsItalic,
        0,
        false
      );

      const newOverlay: TextOverlayItem = {
        id: `text-${Date.now()}`,
        page: currentPage,
        x: newTextCoords.x,
        y: newTextCoords.y,
        originalWidth: layout.measuredWidth,
        width: layout.measuredWidth,
        height: modalFontSize * 1.25,
        text: replacementTextInput.trim(),
        fontSize: modalFontSize,
        fontFamily: modalFontFamily,
        color: modalTextColor,
        isBold: modalIsBold,
        isItalic: modalIsItalic,
        backgroundColor: modalBgColor,
        autoFit: false,
        yOffset: modalYOffset,
        extraRightPad: modalExtraRightPad,
      };
      setOverlays((prev) => [...prev, newOverlay]);
      setSelectedOverlayId(newOverlay.id);
    } else if (editingOverlayId) {
      // Update existing overlay
      setOverlays((prev) =>
        prev.map((o) => {
          if (o.id === editingOverlayId) {
            const layout = computeTextLayout(
              replacementTextInput.trim(),
              modalFontSize,
              modalFontFamily,
              modalIsBold,
              modalIsItalic,
              o.originalWidth,
              modalAutoFit
            );
            return {
              ...o,
              text: replacementTextInput.trim(),
              fontSize: modalFontSize,
              fontFamily: modalFontFamily,
              color: modalTextColor,
              backgroundColor: modalBgColor,
              isBold: modalIsBold,
              isItalic: modalIsItalic,
              autoFit: modalAutoFit,
              yOffset: modalYOffset,
              extraRightPad: modalExtraRightPad,
              width: layout.measuredWidth,
            };
          }
          return o;
        })
      );
    } else if (targetItemToEdit) {
      // Replace existing text in place with exact width tracking
      const layout = computeTextLayout(
        replacementTextInput.trim(),
        modalFontSize,
        modalFontFamily,
        modalIsBold,
        modalIsItalic,
        targetItemToEdit.width,
        modalAutoFit
      );

      const newOverlay: TextOverlayItem = {
        id: `edit-${Date.now()}`,
        page: currentPage,
        x: targetItemToEdit.x,
        y: targetItemToEdit.y,
        originalWidth: targetItemToEdit.width,
        width: layout.measuredWidth,
        height: targetItemToEdit.height,
        text: replacementTextInput.trim(),
        fontSize: modalFontSize,
        fontFamily: modalFontFamily,
        color: modalTextColor,
        isBold: modalIsBold,
        isItalic: modalIsItalic,
        backgroundColor: modalBgColor, // Seamless background patch over original text
        autoFit: modalAutoFit,
        yOffset: modalYOffset,
        extraRightPad: modalExtraRightPad,
      };
      setOverlays((prev) => [...prev, newOverlay]);
      setSelectedOverlayId(newOverlay.id);
    }

    setEditModalOpen(false);
  };

  // Canvas Click Handler with EXACT coordinate scaling
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const clickX = (e.clientX - rect.left) * scaleX;
    const clickY = (e.clientY - rect.top) * scaleY;

    if (activeTool === 'editText') {
      // 1. Check if user clicked an existing overlay to re-edit
      const clickedOverlay = overlays.find(
        (o) =>
          o.page === currentPage &&
          !o.isRedaction &&
          !o.isHighlight &&
          clickX >= o.x - 6 &&
          clickX <= o.x + o.width + (o.extraRightPad || 0) + 6 &&
          clickY >= o.y - 6 &&
          clickY <= o.y + o.height + 6
      );

      if (clickedOverlay) {
        openEditModalForOverlay(clickedOverlay);
        return;
      }

      // 2. Check if user clicked a detected text item
      const clickedItem = pageTextItems.find(
        (t) =>
          clickX >= t.x - 6 &&
          clickX <= t.x + t.width + 6 &&
          clickY >= t.y - 6 &&
          clickY <= t.y + t.height + 6
      );

      if (clickedItem) {
        openEditModalFor(clickedItem);
      } else {
        openNewTextModalAt(clickX, clickY);
      }
    } else if (activeTool === 'addText') {
      openNewTextModalAt(clickX, clickY);
    } else if (activeTool === 'whiteout') {
      const newOverlay: TextOverlayItem = {
        id: `redact-${Date.now()}`,
        page: currentPage,
        x: clickX - 60,
        y: clickY - 15,
        originalWidth: 120,
        width: 120,
        height: 30,
        text: '',
        fontSize: 12,
        fontFamily: 'sans-serif',
        color: '#000000',
        isBold: false,
        isItalic: false,
        backgroundColor: '#ffffff',
        autoFit: false,
        yOffset: 0,
        isRedaction: true,
      };
      setOverlays((prev) => [...prev, newOverlay]);
      setSelectedOverlayId(newOverlay.id);
    } else if (activeTool === 'highlight') {
      const newOverlay: TextOverlayItem = {
        id: `hl-${Date.now()}`,
        page: currentPage,
        x: clickX - 80,
        y: clickY - 12,
        originalWidth: 160,
        width: 160,
        height: 24,
        text: '',
        fontSize: 12,
        fontFamily: 'sans-serif',
        color: '#000000',
        isBold: false,
        isItalic: false,
        backgroundColor: 'rgba(253, 224, 71, 0.45)',
        autoFit: false,
        yOffset: 0,
        isHighlight: true,
      };
      setOverlays((prev) => [...prev, newOverlay]);
      setSelectedOverlayId(newOverlay.id);
    } else if (activeTool === 'select') {
      const pageOverlays = overlays.filter((o) => o.page === currentPage);
      const clicked = pageOverlays.find(
        (o) =>
          clickX >= o.x - 5 &&
          clickX <= o.x + o.width + 5 &&
          clickY >= o.y - 5 &&
          clickY <= o.y + o.height + 5
      );
      setSelectedOverlayId(clicked ? clicked.id : null);
    }
  };

  // Mouse Move over Canvas to detect hover over text blocks
  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const mouseX = (e.clientX - rect.left) * scaleX;
    const mouseY = (e.clientY - rect.top) * scaleY;

    if (activeTool === 'editText') {
      const hovered = pageTextItems.find(
        (t) =>
          mouseX >= t.x - 4 &&
          mouseX <= t.x + t.width + 4 &&
          mouseY >= t.y - 4 &&
          mouseY <= t.y + t.height + 4
      );
      setHoveredTextId(hovered ? hovered.id : null);
    }

    if (isDragging && selectedOverlayId) {
      setOverlays((prev) =>
        prev.map((o) => {
          if (o.id === selectedOverlayId) {
            return {
              ...o,
              x: Math.round(mouseX - dragOffset.x),
              y: Math.round(mouseY - dragOffset.y),
            };
          }
          return o;
        })
      );
    }
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (activeTool !== 'select' || !selectedOverlayId) return;
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const mouseX = (e.clientX - rect.left) * scaleX;
    const mouseY = (e.clientY - rect.top) * scaleY;

    const selected = overlays.find((o) => o.id === selectedOverlayId);
    if (
      selected &&
      mouseX >= selected.x - 5 &&
      mouseX <= selected.x + selected.width + 5 &&
      mouseY >= selected.y - 5 &&
      mouseY <= selected.y + selected.height + 5
    ) {
      setIsDragging(true);
      setDragOffset({ x: mouseX - selected.x, y: mouseY - selected.y });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Export modified PDF preserving 100% of the original design and graphics
  const handleExportPdf = async () => {
    if (!pdfDoc || !canvasRef.current || !overlayCanvasRef.current) return;

    try {
      const mergedCanvas = document.createElement('canvas');
      mergedCanvas.width = canvasRef.current.width;
      mergedCanvas.height = canvasRef.current.height;
      const mctx = mergedCanvas.getContext('2d');
      if (!mctx) return;

      // Draw base PDF with original layout and styling
      mctx.drawImage(canvasRef.current, 0, 0);

      // Draw overlays with precise non-overlapping layout
      const pageOverlays = overlays.filter((item) => item.page === currentPage);
      for (const item of pageOverlays) {
        if (item.isRedaction) {
          mctx.fillStyle = item.backgroundColor || '#ffffff';
          mctx.fillRect(item.x, item.y, item.width, item.height);
        } else if (item.isHighlight) {
          mctx.fillStyle = item.backgroundColor || 'rgba(253, 224, 71, 0.45)';
          mctx.fillRect(item.x, item.y, item.width, item.height);
        } else {
          const layout = computeTextLayout(
            item.text,
            item.fontSize,
            item.fontFamily,
            item.isBold,
            item.isItalic,
            item.originalWidth,
            item.autoFit
          );

          if (item.backgroundColor) {
            mctx.fillStyle = item.backgroundColor;
            const extraRight = item.extraRightPad || 0;
            const maskWidth =
              (item.autoFit
                ? Math.max(item.originalWidth, layout.measuredWidth)
                : Math.max(item.width, layout.measuredWidth)) + extraRight;
            mctx.fillRect(item.x - 2, item.y - 1, maskWidth + 4, item.height + 2);
          }

          mctx.fillStyle = item.color;
          const fontStyle = `${item.isItalic ? 'italic ' : ''}${item.isBold ? 'bold ' : ''}${layout.fittedFontSize}px ${item.fontFamily}`;
          mctx.font = fontStyle;
          mctx.textBaseline = 'top';
          mctx.fillText(item.text, item.x, item.y + (item.yOffset || 0));
        }
      }

      const imgData = mergedCanvas.toDataURL('image/jpeg', 0.95);
      const pdf = new jsPDF({
        orientation: mergedCanvas.width > mergedCanvas.height ? 'landscape' : 'portrait',
        unit: 'px',
        format: [mergedCanvas.width, mergedCanvas.height],
      });

      pdf.addImage(imgData, 'JPEG', 0, 0, mergedCanvas.width, mergedCanvas.height);
      const blob = pdf.output('blob');

      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `Edited_${pdfFile?.name || 'Document.pdf'}`;
      a.click();

      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
      });
    } catch (err) {
      console.error('Failed to export edited PDF:', err);
      alert('Error generating PDF.');
    }
  };

  // Filter page items by search query
  const filteredPageItems = pageTextItems.filter((item) =>
    item.str.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Check if there is an unmerged trailing adjacent fragment on the right of targetItemToEdit
  const adjacentTrailingItem = useMemo(() => {
    if (!targetItemToEdit) return null;
    return rawPageTextItems.find((it) => {
      if (it.id === targetItemToEdit.id) return false;
      const sameLine = Math.abs(it.y - targetItemToEdit.y) <= 4;
      const gap = it.x - (targetItemToEdit.x + targetItemToEdit.width);
      return sameLine && gap >= -4 && gap <= 50;
    });
  }, [targetItemToEdit, rawPageTextItems]);

  // Compute live layout preview inside modal
  const modalLayoutPreview = targetItemToEdit
    ? computeTextLayout(
        replacementTextInput,
        modalFontSize,
        modalFontFamily,
        modalIsBold,
        modalIsItalic,
        targetItemToEdit.width,
        modalAutoFit
      )
    : null;

  return (
    <div className="responsive-container">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
              PDF Direct Text Editor
            </h2>
            <span className="badge badge-subtle">
              Vector Precision
            </span>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '0.2rem' }}>
            Select any text directly on the page to edit with font, style, and color auto-matching.
          </p>
        </div>

        <button onClick={handleLoadSample} disabled={isLoadingPdf} className="btn btn-secondary">
          <FileText size={15} />
          Load Sample PDF
        </button>
      </div>

      {!pdfFile ? (
        /* Upload Dropzone */
        <div
          className="dropzone glass-panel"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files[0]) handleLoadPdf(e.dataTransfer.files[0]);
          }}
          onClick={() => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'application/pdf';
            input.onchange = (e) => {
              const target = e.target as HTMLInputElement;
              if (target.files?.[0]) handleLoadPdf(target.files[0]);
            };
            input.click();
          }}
        >
          <div className="dropzone-icon-ring">
            <FileText size={26} />
          </div>
          <div>
            <h3 style={{ fontSize: '1.15rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
              Choose a PDF file to edit or drop it here
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
              Renders exact vector pages with original fonts, colors, and layout intact
            </p>
          </div>
          <span className="btn btn-primary" style={{ marginTop: '0.25rem' }}>
            Browse Files
          </span>

          {isLoadingPdf && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginTop: '1rem', color: 'var(--text-secondary)' }}>
              <div className="spinner" />
              <span>Analyzing fonts, styles and rendering PDF...</span>
            </div>
          )}
        </div>
      ) : (
        /* Editor Workspace */
        <div>
          {/* Main Toolbar */}
          <div
            className="glass-panel"
            style={{
              padding: '0.75rem 1.25rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '1rem',
              flexWrap: 'wrap',
              gap: '0.75rem',
            }}
          >
            {/* Tool Selection Buttons */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
              <button
                onClick={() => setActiveTool('editText')}
                className={`btn ${activeTool === 'editText' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ padding: '0.45rem 0.85rem', fontSize: '0.85rem' }}
                title="Click any text box on the PDF to edit it"
              >
                <Edit3 size={15} /> Click Text on PDF to Edit
              </button>

              <button
                onClick={() => setActiveTool('addText')}
                className={`btn ${activeTool === 'addText' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ padding: '0.45rem 0.85rem', fontSize: '0.85rem' }}
                title="Click anywhere on the document to add new text"
              >
                <Type size={15} /> Add New Text
              </button>

              <button
                onClick={() => setActiveTool('whiteout')}
                className={`btn ${activeTool === 'whiteout' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ padding: '0.45rem 0.85rem', fontSize: '0.85rem' }}
                title="Cover up unwanted text or graphics"
              >
                <Eraser size={15} /> Whiteout Area
              </button>

              <button
                onClick={() => setActiveTool('highlight')}
                className={`btn ${activeTool === 'highlight' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ padding: '0.45rem 0.85rem', fontSize: '0.85rem' }}
                title="Highlight important text"
              >
                <Highlighter size={15} /> Highlight
              </button>

              <button
                onClick={() => setActiveTool('select')}
                className={`btn ${activeTool === 'select' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ padding: '0.45rem 0.85rem', fontSize: '0.85rem' }}
                title="Move or delete elements"
              >
                <Move size={15} /> Move / Select
              </button>

              {selectedOverlayId && (
                <button
                  onClick={() => {
                    setOverlays((prev) => prev.filter((o) => o.id !== selectedOverlayId));
                    setSelectedOverlayId(null);
                  }}
                  className="btn btn-danger"
                  style={{ padding: '0.45rem 0.85rem', fontSize: '0.85rem' }}
                >
                  <Trash2 size={15} /> Delete Selected
                </button>
              )}
            </div>

            {/* Typography Controls */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <select
                value={fontFamily}
                onChange={(e) => setFontFamily(e.target.value)}
                className="select-input"
                style={{ padding: '0.4rem 0.6rem', fontSize: '0.8rem' }}
              >
                <option value="'Plus Jakarta Sans', system-ui, -apple-system, sans-serif">Modern Sans-Serif</option>
                <option value="Arial, Helvetica, sans-serif">Arial / Helvetica</option>
                <option value="'Times New Roman', Georgia, serif">Times New Roman / Serif</option>
                <option value="'JetBrains Mono', 'Courier New', monospace">Monospace</option>
                <option value="Calibri, Arial, sans-serif">Calibri</option>
              </select>

              <select
                value={fontSize}
                onChange={(e) => setFontSize(Number(e.target.value))}
                className="select-input"
                style={{ padding: '0.4rem 0.6rem', fontSize: '0.8rem' }}
              >
                <option value={9}>9 pt</option>
                <option value={10}>10 pt</option>
                <option value={11}>11 pt</option>
                <option value={12}>12 pt</option>
                <option value={13}>13 pt</option>
                <option value={14}>14 pt</option>
                <option value={16}>16 pt</option>
                <option value={18}>18 pt</option>
                <option value={20}>20 pt</option>
                <option value={24}>24 pt</option>
              </select>

              <input
                type="color"
                value={textColor}
                onChange={(e) => setTextColor(e.target.value)}
                style={{ width: '30px', height: '30px', borderRadius: '4px', border: '1px solid var(--border-subtle)', background: 'transparent', cursor: 'pointer' }}
                title="Text Color"
              />

              <button
                onClick={() => setIsBold(!isBold)}
                className={`btn-icon ${isBold ? 'active' : ''}`}
                style={{ fontWeight: 'bold', width: '30px', height: '30px' }}
                title="Bold"
              >
                B
              </button>

              <button
                onClick={() => setIsItalic(!isItalic)}
                className={`btn-icon ${isItalic ? 'active' : ''}`}
                style={{ fontStyle: 'italic', width: '30px', height: '30px' }}
                title="Italic"
              >
                I
              </button>

              <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.78rem', color: 'var(--text-secondary)', cursor: 'pointer', marginLeft: '0.4rem' }}>
                <input
                  type="checkbox"
                  checked={showTextBoundingBoxes}
                  onChange={(e) => setShowTextBoundingBoxes(e.target.checked)}
                  style={{ accentColor: '#6366f1' }}
                />
                <span>Show Text Boxes</span>
              </label>

              <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)', padding: '2px', border: '1px solid var(--border-subtle)', marginLeft: '0.4rem' }}>
                <button
                  type="button"
                  onClick={() => setTextGranularity('line')}
                  className={`btn ${textGranularity === 'line' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ padding: '0.2rem 0.5rem', fontSize: '0.73rem' }}
                  title="Group words on the same line into complete sentences"
                >
                  Full Lines
                </button>
                <button
                  type="button"
                  onClick={() => setTextGranularity('word')}
                  className={`btn ${textGranularity === 'word' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ padding: '0.2rem 0.5rem', fontSize: '0.73rem' }}
                  title="Select individual words"
                >
                  Words
                </button>
              </div>
            </div>

            {/* Navigation & Export */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                  className="btn-icon"
                  style={{ opacity: currentPage <= 1 ? 0.3 : 1 }}
                >
                  <ChevronLeft size={16} />
                </button>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', padding: '0 0.4rem' }}>
                  {currentPage} / {totalPages}
                </span>
                <button
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage >= totalPages}
                  className="btn-icon"
                  style={{ opacity: currentPage >= totalPages ? 0.3 : 1 }}
                >
                  <ChevronRight size={16} />
                </button>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <button onClick={() => setZoomScale((z) => Math.max(0.4, Number((z - 0.15).toFixed(2))))} className="btn-icon" title="Zoom Out">
                  <ZoomOut size={16} />
                </button>
                <span style={{ fontSize: '0.78rem', fontWeight: 600, minWidth: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                  {Math.round(zoomScale * 100)}%
                </span>
                <button onClick={() => setZoomScale((z) => Math.min(2.5, Number((z + 0.15).toFixed(2))))} className="btn-icon" title="Zoom In">
                  <ZoomIn size={16} />
                </button>
                <button
                  onClick={() => {
                    const fitScale = Math.max(0.4, Number(((window.innerWidth - (window.innerWidth <= 768 ? 32 : 440)) / 600).toFixed(2)));
                    setZoomScale(fitScale);
                  }}
                  className="btn btn-secondary"
                  style={{ padding: '0.35rem 0.6rem', fontSize: '0.75rem' }}
                  title="Fit PDF width to screen"
                >
                  Fit
                </button>
              </div>

              <button
                onClick={() => {
                  setPdfFile(null);
                  setPdfDoc(null);
                }}
                className="btn btn-secondary"
                style={{ padding: '0.45rem 0.75rem', fontSize: '0.8rem' }}
                title="Change Document"
              >
                <RefreshCw size={14} /> Change
              </button>

              <button onClick={handleExportPdf} className="btn btn-emerald" style={{ padding: '0.5rem 1.1rem' }}>
                <Download size={16} /> Download Edited PDF
              </button>
            </div>
          </div>

          {/* Guidance Banner */}
          <div
            style={{
              padding: '0.55rem 1rem',
              background: 'var(--primary-light)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-subtle)',
              fontSize: '0.82rem',
              color: 'var(--text-primary)',
              marginBottom: '1rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '1rem',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <CheckCircle2 size={15} color="var(--primary)" />
              <span>
                <strong>Smart Font & Spacing Active:</strong> Click any highlighted text box to modify with auto-matched fonts, styles & colors.
              </span>
            </div>
            <span className="badge badge-emerald">
              ✓ Collision Protection
            </span>
          </div>

          {/* Interactive Canvas & Side Text Panel */}
          <div className="editor-grid">
            {/* Left: Interactive Canvas with Exact PDF Layout */}
            <div
              className="workspace-canvas-wrapper"
              style={{
                overflowX: 'auto',
                display: 'flex',
                justifyContent: 'center',
                position: 'relative',
              }}
            >
              <div
                style={{
                  position: 'relative',
                  boxShadow: 'var(--shadow-lg)',
                  borderRadius: '4px',
                  overflow: 'hidden',
                  background: '#ffffff',
                }}
              >
                {/* Crisp rendered base PDF canvas */}
                <canvas ref={canvasRef} style={{ display: 'block' }} />

                {/* Overlay interaction layer */}
                <canvas
                  ref={overlayCanvasRef}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    cursor: activeTool === 'editText' ? 'pointer' : activeTool === 'select' ? 'default' : 'crosshair',
                  }}
                  onClick={handleCanvasClick}
                  onMouseMove={handleCanvasMouseMove}
                  onMouseDown={handleMouseDown}
                  onMouseUp={handleMouseUp}
                />
              </div>
            </div>

            {/* Right: Detected Text Side Panel */}
            <div className="glass-panel editor-sidebar" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column' }}>
              <div style={{ marginBottom: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
                  <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    Page Text Blocks ({pageTextItems.length})
                  </h3>
                  <span className="badge badge-blue">Page {currentPage}</span>
                </div>

                <div style={{ position: 'relative' }}>
                  <input
                    type="text"
                    placeholder="Search or filter text..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="input-text"
                    style={{ width: '100%', paddingLeft: '2rem', fontSize: '0.8rem' }}
                  />
                  <Search size={14} style={{ position: 'absolute', left: '0.7rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                </div>
              </div>

              {/* List of text items */}
              <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem', paddingRight: '0.3rem' }}>
                {filteredPageItems.map((item) => {
                  const isHovered = hoveredTextId === item.id;
                  return (
                    <div
                      key={item.id}
                      onMouseEnter={() => setHoveredTextId(item.id)}
                      onMouseLeave={() => setHoveredTextId(null)}
                      onClick={() => openEditModalFor(item)}
                      style={{
                        padding: '0.6rem 0.8rem',
                        borderRadius: 'var(--radius-md)',
                        background: isHovered ? 'var(--primary-light)' : 'var(--bg-tertiary)',
                        border: `1px solid ${isHovered ? 'var(--border-focus)' : 'var(--border-subtle)'}`,
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
                        <span style={{ fontSize: '0.72rem', color: 'var(--primary)', fontWeight: 600 }}>
                          {item.fontSize}pt • {item.fontFamily.split(',')[0].replace(/['"]/g, '')}
                        </span>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                          <Edit3 size={11} /> Edit
                        </span>
                      </div>
                      <p style={{ fontSize: '0.84rem', color: 'var(--text-primary)', lineHeight: '1.4', wordBreak: 'break-word' }}>
                        {item.str}
                      </p>
                    </div>
                  );
                })}

                {filteredPageItems.length === 0 && (
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', textAlign: 'center', marginTop: '2rem' }}>
                    No matching text found
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* IN-PLACE TEXT EDIT DIALOG (Smart Auto-Match & Collision Prevention)    */}
      {/* ===================================================================== */}
      {editModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.72)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '1rem',
          }}
          onClick={() => setEditModalOpen(false)}
        >
          <div
            className="glass-panel"
            style={{
              width: '100%',
              maxWidth: '560px',
              padding: '1.5rem',
              background: 'var(--bg-card)',
              border: '1px solid var(--border-medium)',
              boxShadow: 'var(--shadow-lg)',
              maxHeight: '92vh',
              overflowY: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.2rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Edit3 size={18} color="var(--primary)" />
                <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {isNewTextModal ? 'Insert New Text on PDF' : 'Edit PDF Text'}
                </h3>
              </div>
              <button onClick={() => setEditModalOpen(false)} className="btn-icon">
                <X size={16} />
              </button>
            </div>

            {/* Original text reference & Detected font info */}
            {!isNewTextModal && targetItemToEdit && (
              <div style={{ marginBottom: '1rem', padding: '0.75rem', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Original Text in PDF:
                  </span>
                  <span style={{ fontSize: '0.72rem', color: 'var(--primary)', fontWeight: 600 }}>
                    Width: {Math.round(targetItemToEdit.width)}px • {targetItemToEdit.fontSize}pt {targetItemToEdit.fontFamily.split(',')[0].replace(/['"]/g, '')}
                  </span>
                </div>
                <p style={{ fontSize: '0.9rem', color: 'var(--text-primary)', fontStyle: 'italic', wordBreak: 'break-word' }}>
                  "{targetItemToEdit.str}"
                </p>
              </div>
            )}

            {/* Adjacent Trailing Fragment Alert */}
            {adjacentTrailingItem && (
              <div
                style={{
                  marginBottom: '1rem',
                  padding: '0.65rem 0.85rem',
                  background: 'rgba(245, 158, 11, 0.12)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid rgba(245, 158, 11, 0.35)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '0.75rem',
                  flexWrap: 'wrap',
                }}
              >
                <div>
                  <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#fbbf24', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <AlertTriangle size={14} /> Trailing text on right: "{adjacentTrailingItem.str}"
                  </div>
                  <p style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                    Adjacent text found right next to this slot. Include it to avoid orphan text like "{adjacentTrailingItem.str}"?
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    const extraWidthNeeded = Math.round(adjacentTrailingItem.width + 12);
                    setModalExtraRightPad((p) => Math.max(p, extraWidthNeeded));
                    if (!replacementTextInput.includes(adjacentTrailingItem.str)) {
                      setReplacementTextInput((prev) => prev.trim() + (prev.endsWith(' ') ? '' : ' ') + adjacentTrailingItem.str);
                    }
                  }}
                  className="btn btn-secondary"
                  style={{
                    padding: '0.35rem 0.75rem',
                    fontSize: '0.78rem',
                    borderColor: '#f59e0b',
                    color: '#fbbf24',
                    background: 'rgba(245, 158, 11, 0.15)',
                  }}
                >
                  + Include & Erase "{adjacentTrailingItem.str}"
                </button>
              </div>
            )}

            {/* Replacement input */}
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>
                {isNewTextModal ? 'Text to Insert:' : 'Replacement Text:'}
              </label>
              <textarea
                value={replacementTextInput}
                onChange={(e) => setReplacementTextInput(e.target.value)}
                autoFocus
                rows={3}
                className="input-text"
                style={{ width: '100%', fontSize: '0.95rem', resize: 'vertical' }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleApplyModalEdit();
                  }
                }}
              />
            </div>

            {/* Auto-Fit Protection Toggle */}
            {!isNewTextModal && targetItemToEdit && (
              <div style={{ marginBottom: '1.2rem', padding: '0.65rem 0.85rem', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', fontSize: '0.85rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <ShieldCheck size={16} color="var(--primary)" />
                    <div>
                      <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Auto-Fit within original width</span>
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        Scales font down if text is longer so it never overlaps adjacent words
                      </p>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={modalAutoFit}
                    onChange={(e) => setModalAutoFit(e.target.checked)}
                    style={{ accentColor: 'var(--primary)', width: '16px', height: '16px' }}
                  />
                </label>

                {/* Overlap Status Preview */}
                {modalLayoutPreview && (
                  <div style={{ marginTop: '0.5rem', paddingTop: '0.4rem', borderTop: '1px solid rgba(255,255,255,0.06)', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    {modalLayoutPreview.isScaled ? (
                      <span style={{ color: '#67e8f9' }}>
                        ⚡ Text is longer: Font auto-scaled from {modalFontSize}pt → <strong>{modalLayoutPreview.fittedFontSize}pt</strong> to prevent overlapping next words.
                      </span>
                    ) : modalLayoutPreview.measuredWidth <= targetItemToEdit.width ? (
                      <span style={{ color: '#6ee7b7' }}>
                        ✓ Text fits cleanly in original slot ({Math.round(modalLayoutPreview.measuredWidth)}px / {Math.round(targetItemToEdit.width)}px). Zero overlap!
                      </span>
                    ) : (
                      <span style={{ color: '#fcd34d', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                        <AlertTriangle size={13} /> Text exceeds original width by {Math.round(modalLayoutPreview.measuredWidth - targetItemToEdit.width)}px (turn on Auto-Fit to prevent overlap).
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Typography fine-tuning controls */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '0.75rem', marginBottom: '1.4rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                  Font Family
                </label>
                <select
                  value={modalFontFamily}
                  onChange={(e) => setModalFontFamily(e.target.value)}
                  className="select-input"
                  style={{ width: '100%', padding: '0.4rem 0.5rem', fontSize: '0.8rem' }}
                >
                  <option value="'Plus Jakarta Sans', system-ui, -apple-system, sans-serif">Modern Sans</option>
                  <option value="Arial, Helvetica, sans-serif">Arial / Helvetica</option>
                  <option value="'Times New Roman', Georgia, serif">Times New Roman</option>
                  <option value="'JetBrains Mono', 'Courier New', monospace">Monospace</option>
                  <option value="Calibri, Arial, sans-serif">Calibri</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                  Base Font Size
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  <button
                    type="button"
                    onClick={() => setModalFontSize((s) => Math.max(7, s - 1))}
                    className="btn-icon"
                    style={{ width: '28px', height: '28px' }}
                  >
                    -
                  </button>
                  <span style={{ fontSize: '0.85rem', fontWeight: 600, minWidth: '38px', textAlign: 'center' }}>
                    {modalFontSize}pt
                  </span>
                  <button
                    type="button"
                    onClick={() => setModalFontSize((s) => Math.min(48, s + 1))}
                    className="btn-icon"
                    style={{ width: '28px', height: '28px' }}
                  >
                    +
                  </button>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                  Baseline Nudge
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  <button
                    type="button"
                    onClick={() => setModalYOffset((y) => y - 1)}
                    className="btn-icon"
                    style={{ width: '28px', height: '28px' }}
                    title="Nudge Up"
                  >
                    ↑
                  </button>
                  <span style={{ fontSize: '0.82rem', minWidth: '32px', textAlign: 'center' }}>
                    {modalYOffset > 0 ? `+${modalYOffset}` : modalYOffset}px
                  </span>
                  <button
                    type="button"
                    onClick={() => setModalYOffset((y) => y + 1)}
                    className="btn-icon"
                    style={{ width: '28px', height: '28px' }}
                    title="Nudge Down"
                  >
                    ↓
                  </button>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                  Text Color
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <input
                    type="color"
                    value={modalTextColor.startsWith('rgb') ? '#2b2b2b' : modalTextColor}
                    onChange={(e) => setModalTextColor(e.target.value)}
                    style={{ width: '30px', height: '30px', borderRadius: '4px', border: '1px solid var(--border-subtle)', background: 'transparent', cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Auto-Sampled</span>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                  Cover Background
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <input
                    type="color"
                    value={modalBgColor.startsWith('rgb') ? '#ffffff' : modalBgColor === 'transparent' ? '#ffffff' : modalBgColor}
                    onChange={(e) => setModalBgColor(e.target.value)}
                    style={{ width: '30px', height: '30px', borderRadius: '4px', border: '1px solid var(--border-subtle)', background: 'transparent', cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Auto-Sampled</span>
                </div>
              </div>

              {/* Erase Mask Extra Width */}
              <div style={{ gridColumn: '1 / -1', paddingTop: '0.6rem', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                  <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                    Erase Mask Extension: <strong style={{ color: '#818cf8' }}>+{modalExtraRightPad}px</strong>
                  </label>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    Widens whiteout mask to erase trailing punctuation/characters
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  {[0, 10, 20, 35, 60, 100].map((pad) => (
                    <button
                      key={pad}
                      type="button"
                      onClick={() => setModalExtraRightPad(pad)}
                      className={`btn ${modalExtraRightPad === pad ? 'btn-primary' : 'btn-secondary'}`}
                      style={{ padding: '0.2rem 0.55rem', fontSize: '0.74rem' }}
                    >
                      {pad === 0 ? '0px' : `+${pad}px`}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setModalExtraRightPad((p) => p + 15)}
                    className="btn btn-secondary"
                    style={{ padding: '0.2rem 0.55rem', fontSize: '0.74rem' }}
                    title="Nudge right by 15px"
                  >
                    +15px
                  </button>
                </div>
              </div>
            </div>

            {/* Modal Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button onClick={() => setEditModalOpen(false)} className="btn btn-secondary">
                Cancel
              </button>
              <button onClick={handleApplyModalEdit} className="btn btn-primary">
                <Check size={16} /> Apply Edit to PDF
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

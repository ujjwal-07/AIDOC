import React, { useState, useRef, useEffect } from 'react';
import {
  Scan,
  Type,
  Eraser,
  Download,
  Sparkles,
  CheckCircle2,
  Trash2,
  Move,
  FileText,
  Search,
  Edit3,
  X,
  RotateCcw,
  AlertCircle
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { recognizeImageText, createSampleReceiptImage, getSampleReceiptBlocks } from '../../utils/tesseractOcr';
import type { OcrTextBlock } from '../../utils/tesseractOcr';
import jsPDF from 'jspdf';

export interface ImageOverlayItem {
  id: string;
  x: number;
  y: number;
  originalWidth: number;
  width: number;
  height: number;
  text: string;
  originalText?: string;
  fontSize: number;
  fontFamily: string;
  color: string;
  isBold: boolean;
  isItalic: boolean;
  backgroundColor: string;
  autoFit: boolean;
  yOffset: number;
  inpaintPadding: number;
  isEraser?: boolean;
}

/**
 * Converts RGB numbers to hex code #RRGGBB
 */
function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Samples surrounding background color and inner text color from canvas
 */
function sampleImageTextAndBgColor(
  canvas: HTMLCanvasElement,
  bbox: { x0: number; y0: number; x1: number; y1: number }
): { textColor: string; bgColor: string } {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { textColor: '#0f172a', bgColor: '#ffffff' };

  try {
    const x = Math.max(0, Math.floor(bbox.x0));
    const y = Math.max(0, Math.floor(bbox.y0));
    const w = Math.max(1, Math.min(Math.floor(bbox.x1 - bbox.x0), canvas.width - x));
    const h = Math.max(1, Math.min(Math.floor(bbox.y1 - bbox.y0), canvas.height - y));

    const imgData = ctx.getImageData(x, y, w, h).data;
    if (imgData.length < 4) return { textColor: '#0f172a', bgColor: '#ffffff' };

    // 1. Sample Background color from perimeter corners of bounding box
    const cornerIndices = [
      0, // top-left
      Math.min(w - 1, w - 1) * 4, // top-right
      ((h - 1) * w) * 4, // bottom-left
      ((h - 1) * w + (w - 1)) * 4, // bottom-right
    ];

    let sumR = 0, sumG = 0, sumB = 0;
    let count = 0;

    for (const idx of cornerIndices) {
      if (idx >= 0 && idx + 2 < imgData.length) {
        sumR += imgData[idx];
        sumG += imgData[idx + 1];
        sumB += imgData[idx + 2];
        count++;
      }
    }

    const bgR = count > 0 ? Math.round(sumR / count) : 255;
    const bgG = count > 0 ? Math.round(sumG / count) : 255;
    const bgB = count > 0 ? Math.round(sumB / count) : 255;
    const bgBrightness = (bgR * 299 + bgG * 587 + bgB * 114) / 1000;

    // 2. Sample text color by finding pixel inside inner 60% with highest contrast against background
    let maxDiff = -1;
    let textR = bgBrightness > 128 ? 15 : 255;
    let textG = bgBrightness > 128 ? 23 : 255;
    let textB = bgBrightness > 128 ? 42 : 255;

    const startX = Math.floor(w * 0.15);
    const endX = Math.floor(w * 0.85);
    const startY = Math.floor(h * 0.15);
    const endY = Math.floor(h * 0.85);

    for (let py = startY; py < endY; py++) {
      for (let px = startX; px < endX; px++) {
        const idx = (py * w + px) * 4;
        if (idx + 3 < imgData.length && imgData[idx + 3] > 100) {
          const r = imgData[idx];
          const g = imgData[idx + 1];
          const b = imgData[idx + 2];
          const brightness = (r * 299 + g * 587 + b * 114) / 1000;
          const diff = Math.abs(brightness - bgBrightness);
          if (diff > maxDiff) {
            maxDiff = diff;
            textR = r;
            textG = g;
            textB = b;
          }
        }
      }
    }

    return {
      textColor: rgbToHex(textR, textG, textB),
      bgColor: rgbToHex(bgR, bgG, bgB),
    };
  } catch {
    return { textColor: '#0f172a', bgColor: '#ffffff' };
  }
}

/**
 * Computes fitted font size to prevent overlapping neighboring text
 */
function computeImageTextLayout(
  text: string,
  targetFontSize: number,
  fontFamily: string,
  isBold: boolean,
  isItalic: boolean,
  targetWidth: number,
  autoFit: boolean
): { fittedFontSize: number; measuredWidth: number } {
  if (!text) return { fittedFontSize: targetFontSize, measuredWidth: targetWidth };

  const offscreen = document.createElement('canvas');
  const ctx = offscreen.getContext('2d');
  if (!ctx) return { fittedFontSize: targetFontSize, measuredWidth: targetWidth };

  let currentFontSize = targetFontSize;
  const fontStyle = `${isItalic ? 'italic ' : ''}${isBold ? 'bold ' : ''}`;
  ctx.font = `${fontStyle}${currentFontSize}px ${fontFamily}`;
  let width = ctx.measureText(text).width;

  if (autoFit && targetWidth > 0 && width > targetWidth) {
    const scale = targetWidth / width;
    currentFontSize = Math.max(9, Math.floor(targetFontSize * scale));
    ctx.font = `${fontStyle}${currentFontSize}px ${fontFamily}`;
    width = ctx.measureText(text).width;
  }

  return { fittedFontSize: currentFontSize, measuredWidth: width };
}

export const ImageTextEditor: React.FC = () => {
  const [imageUrl, setImageUrl] = useState<string>('');
  const [imageName, setImageName] = useState<string>('Receipt_Sample.png');
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });

  // OCR state
  const [isScanningOcr, setIsScanningOcr] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrStatus, setOcrStatus] = useState('');
  const [ocrWordBlocks, setOcrWordBlocks] = useState<OcrTextBlock[]>([]);
  const [ocrLineBlocks, setOcrLineBlocks] = useState<OcrTextBlock[]>([]);
  const [ocrGranularity, setOcrGranularity] = useState<'words' | 'lines'>('words');
  const [showBoundingBoxes, setShowBoundingBoxes] = useState(true);
  const [hoveredBlockId, setHoveredBlockId] = useState<string | null>(null);

  // Active Tool: 'editText' | 'addText' | 'erase' | 'select'
  const [activeTool, setActiveTool] = useState<'editText' | 'addText' | 'erase' | 'select'>('editText');

  // Overlays
  const [overlays, setOverlays] = useState<ImageOverlayItem[]>([]);
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);

  // Sidebar state
  const [sidebarTab, setSidebarTab] = useState<'detected' | 'applied'>('detected');
  const [searchQuery, setSearchQuery] = useState('');

  // Floating hover tooltip on canvas
  const [canvasTooltip, setCanvasTooltip] = useState<{ text: string; x: number; y: number } | null>(null);

  // Edit Modal State
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [targetBlockToEdit, setTargetBlockToEdit] = useState<OcrTextBlock | null>(null);
  const [editingOverlayId, setEditingOverlayId] = useState<string | null>(null);
  const [newTextCoords, setNewTextCoords] = useState<{ x: number; y: number } | null>(null);

  // Modal form inputs
  const [replacementTextInput, setReplacementTextInput] = useState('');
  const [modalFontSize, setModalFontSize] = useState(16);
  const [modalFontFamily, setModalFontFamily] = useState("'Plus Jakarta Sans', sans-serif");
  const [modalTextColor, setModalTextColor] = useState('#0f172a');
  const [modalBgColor, setModalBgColor] = useState('#ffffff');
  const [modalIsBold, setModalIsBold] = useState(true);
  const [modalIsItalic, setModalIsItalic] = useState(false);
  const [modalAutoFit, setModalAutoFit] = useState(true);
  const [modalYOffset, setModalYOffset] = useState(0);
  const [modalInpaintPad, setModalInpaintPad] = useState(2);

  // Dragging state
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const textInputRef = useRef<HTMLTextAreaElement>(null);

  // Current active OCR blocks (words vs lines)
  const currentOcrBlocks = ocrGranularity === 'words' ? ocrWordBlocks : ocrLineBlocks;

  // Filtered blocks for sidebar search
  const filteredOcrBlocks = currentOcrBlocks.filter((b) =>
    b.text.toLowerCase().includes(searchQuery.toLowerCase().trim())
  );

  // ---------------------------------------------------------------------------
  // Image Loading & OCR Execution
  // ---------------------------------------------------------------------------

  const runOcrOnUrl = async (sourceUrl: string) => {
    setIsScanningOcr(true);
    setOcrProgress(5);
    setOcrStatus('Initializing OCR engine...');
    try {
      const result = await recognizeImageText(sourceUrl, (prog, stat) => {
        setOcrProgress(prog);
        setOcrStatus(stat);
      });
      setOcrWordBlocks(result.blocks || []);
      setOcrLineBlocks(result.lines || []);
      confetti({
        particleCount: 75,
        spread: 60,
        origin: { y: 0.6 },
      });
    } catch (err) {
      console.error('OCR failed:', err);
    } finally {
      setIsScanningOcr(false);
    }
  };

  const handleLoadImage = (file: File) => {
    const url = URL.createObjectURL(file);
    setImageUrl(url);
    setImageName(file.name);
    setOverlays([]);
    setOcrWordBlocks([]);
    setOcrLineBlocks([]);

    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      setImageDimensions({ width: img.naturalWidth, height: img.naturalHeight });
      // Automatically run OCR on upload for effortless workflow
      runOcrOnUrl(url);
    };
    img.src = url;
  };

  const handleLoadSampleReceipt = () => {
    const dataUrl = createSampleReceiptImage();
    const sample = getSampleReceiptBlocks();
    setImageUrl(dataUrl);
    setImageName('Nexus_Tech_Receipt.png');
    setOverlays([]);
    setOcrWordBlocks(sample.blocks);
    setOcrLineBlocks(sample.lines);

    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      setImageDimensions({ width: img.naturalWidth, height: img.naturalHeight });
      confetti({
        particleCount: 60,
        spread: 60,
        origin: { y: 0.6 },
      });
    };
    img.src = dataUrl;
  };

  // ---------------------------------------------------------------------------
  // Canvas Rendering (Base Image + Interactive Overlay)
  // ---------------------------------------------------------------------------

  // Render base image
  useEffect(() => {
    if (!imageUrl || !imgRef.current) return;
    const canvas = canvasRef.current;
    const overlayCanvas = overlayCanvasRef.current;
    if (!canvas || !overlayCanvas) return;

    canvas.width = imgRef.current.naturalWidth;
    canvas.height = imgRef.current.naturalHeight;
    overlayCanvas.width = imgRef.current.naturalWidth;
    overlayCanvas.height = imgRef.current.naturalHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(imgRef.current, 0, 0);
  }, [imageUrl, imageDimensions]);

  // Redraw overlays & bounding boxes
  useEffect(() => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 1. Draw detected OCR bounding boxes if enabled
    if (showBoundingBoxes && currentOcrBlocks.length > 0 && activeTool === 'editText') {
      for (const block of currentOcrBlocks) {
        const isHovered = hoveredBlockId === block.id;
        const w = block.bbox.x1 - block.bbox.x0;
        const h = block.bbox.y1 - block.bbox.y0;

        ctx.fillStyle = isHovered ? 'rgba(99, 102, 241, 0.28)' : 'rgba(99, 102, 241, 0.08)';
        ctx.fillRect(block.bbox.x0, block.bbox.y0, w, h);

        ctx.strokeStyle = isHovered ? '#6366f1' : 'rgba(99, 102, 241, 0.45)';
        ctx.lineWidth = isHovered ? 2.5 : 1.2;
        ctx.strokeRect(block.bbox.x0, block.bbox.y0, w, h);
      }
    }

    // 2. Draw user modifications & inpaint text replacements
    for (const item of overlays) {
      if (item.isEraser) {
        // Erase / Inpaint patch
        ctx.fillStyle = item.backgroundColor;
        ctx.fillRect(item.x, item.y, item.width, item.height);
        ctx.strokeStyle = 'rgba(99, 102, 241, 0.3)';
        ctx.strokeRect(item.x, item.y, item.width, item.height);
      } else {
        const layout = computeImageTextLayout(
          item.text,
          item.fontSize,
          item.fontFamily,
          item.isBold,
          item.isItalic,
          item.originalWidth,
          item.autoFit
        );

        const pad = item.inpaintPadding ?? 2;
        const patchWidth = item.autoFit
          ? Math.max(item.originalWidth, layout.measuredWidth)
          : Math.max(item.width, layout.measuredWidth);

        // Clean inpaint background patch
        ctx.fillStyle = item.backgroundColor;
        ctx.fillRect(item.x - pad, item.y - pad, patchWidth + pad * 2, item.height + pad * 2);

        // Render typography
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
          ctx.strokeRect(item.x - pad - 1, item.y - pad - 1, patchWidth + pad * 2 + 2, item.height + pad * 2 + 2);
          ctx.setLineDash([]);
        }
      }
    }
  }, [overlays, currentOcrBlocks, showBoundingBoxes, selectedOverlayId, hoveredBlockId, activeTool]);

  // Focus textarea when modal opens
  useEffect(() => {
    if (editModalOpen) {
      setTimeout(() => {
        textInputRef.current?.focus();
        textInputRef.current?.select();
      }, 50);
    }
  }, [editModalOpen]);

  // ---------------------------------------------------------------------------
  // Modal Open Handlers
  // ---------------------------------------------------------------------------

  const openEditModalFor = (block: OcrTextBlock) => {
    const canvas = canvasRef.current;
    const sampled = canvas
      ? sampleImageTextAndBgColor(canvas, block.bbox)
      : { textColor: '#0f172a', bgColor: '#ffffff' };

    const blockHeight = block.bbox.y1 - block.bbox.y0;
    const estimatedFontSize = Math.max(11, Math.round(blockHeight * 0.8));

    setTargetBlockToEdit(block);
    setEditingOverlayId(null);
    setNewTextCoords(null);
    setReplacementTextInput(block.text);
    setModalFontSize(estimatedFontSize);
    setModalTextColor(sampled.textColor);
    setModalBgColor(sampled.bgColor);
    setModalFontFamily("'Plus Jakarta Sans', sans-serif");
    setModalIsBold(true);
    setModalIsItalic(false);
    setModalAutoFit(true);
    setModalYOffset(0);
    setModalInpaintPad(2);
    setEditModalOpen(true);
  };

  const openEditModalForOverlay = (overlay: ImageOverlayItem) => {
    setEditingOverlayId(overlay.id);
    setTargetBlockToEdit(null);
    setNewTextCoords(null);
    setReplacementTextInput(overlay.text);
    setModalFontSize(overlay.fontSize);
    setModalTextColor(overlay.color);
    setModalBgColor(overlay.backgroundColor);
    setModalFontFamily(overlay.fontFamily);
    setModalIsBold(overlay.isBold);
    setModalIsItalic(overlay.isItalic);
    setModalAutoFit(overlay.autoFit);
    setModalYOffset(overlay.yOffset);
    setModalInpaintPad(overlay.inpaintPadding);
    setEditModalOpen(true);
  };

  const openNewTextModalAt = (x: number, y: number) => {
    const canvas = canvasRef.current;
    const sampled = canvas
      ? sampleImageTextAndBgColor(canvas, { x0: x, y0: y, x1: x + 60, y1: y + 20 })
      : { textColor: '#0f172a', bgColor: '#ffffff' };

    setTargetBlockToEdit(null);
    setEditingOverlayId(null);
    setNewTextCoords({ x, y });
    setReplacementTextInput('');
    setModalFontSize(16);
    setModalTextColor(sampled.textColor);
    setModalBgColor(sampled.bgColor);
    setModalFontFamily("'Plus Jakarta Sans', sans-serif");
    setModalIsBold(false);
    setModalIsItalic(false);
    setModalAutoFit(false);
    setModalYOffset(0);
    setModalInpaintPad(2);
    setEditModalOpen(true);
  };

  // Quick 1-click erase original block
  const handleEraseOriginalBlock = (block: OcrTextBlock) => {
    const canvas = canvasRef.current;
    const sampled = canvas
      ? sampleImageTextAndBgColor(canvas, block.bbox)
      : { textColor: '#0f172a', bgColor: '#ffffff' };

    const w = block.bbox.x1 - block.bbox.x0;
    const h = block.bbox.y1 - block.bbox.y0;

    const newOverlay: ImageOverlayItem = {
      id: `erase-${Date.now()}`,
      x: block.bbox.x0,
      y: block.bbox.y0,
      originalWidth: w,
      width: w,
      height: h,
      text: '',
      fontSize: 12,
      fontFamily: 'sans-serif',
      color: '#000000',
      isBold: false,
      isItalic: false,
      backgroundColor: sampled.bgColor,
      autoFit: false,
      yOffset: 0,
      inpaintPadding: 2,
      isEraser: true,
    };

    setOverlays((prev) => [...prev, newOverlay]);
    setSelectedOverlayId(newOverlay.id);
  };

  // ---------------------------------------------------------------------------
  // Modal Save & Apply
  // ---------------------------------------------------------------------------

  const handleApplyModalEdit = () => {
    if (!replacementTextInput.trim()) return;

    if (editingOverlayId) {
      // Update existing overlay
      setOverlays((prev) =>
        prev.map((o) => {
          if (o.id === editingOverlayId) {
            const layout = computeImageTextLayout(
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
              inpaintPadding: modalInpaintPad,
              width: layout.measuredWidth,
            };
          }
          return o;
        })
      );
    } else if (targetBlockToEdit) {
      // Replace detected OCR block
      const blockWidth = targetBlockToEdit.bbox.x1 - targetBlockToEdit.bbox.x0;
      const blockHeight = targetBlockToEdit.bbox.y1 - targetBlockToEdit.bbox.y0;

      const layout = computeImageTextLayout(
        replacementTextInput.trim(),
        modalFontSize,
        modalFontFamily,
        modalIsBold,
        modalIsItalic,
        blockWidth,
        modalAutoFit
      );

      const newOverlay: ImageOverlayItem = {
        id: `img-edit-${Date.now()}`,
        x: targetBlockToEdit.bbox.x0,
        y: targetBlockToEdit.bbox.y0,
        originalWidth: blockWidth,
        width: layout.measuredWidth,
        height: blockHeight,
        text: replacementTextInput.trim(),
        originalText: targetBlockToEdit.text,
        fontSize: modalFontSize,
        fontFamily: modalFontFamily,
        color: modalTextColor,
        isBold: modalIsBold,
        isItalic: modalIsItalic,
        backgroundColor: modalBgColor,
        autoFit: modalAutoFit,
        yOffset: modalYOffset,
        inpaintPadding: modalInpaintPad,
      };

      setOverlays((prev) => [...prev, newOverlay]);
      setSelectedOverlayId(newOverlay.id);
    } else if (newTextCoords) {
      // Add custom new text
      const layout = computeImageTextLayout(
        replacementTextInput.trim(),
        modalFontSize,
        modalFontFamily,
        modalIsBold,
        modalIsItalic,
        0,
        false
      );

      const newOverlay: ImageOverlayItem = {
        id: `new-text-${Date.now()}`,
        x: newTextCoords.x,
        y: newTextCoords.y,
        originalWidth: layout.measuredWidth,
        width: layout.measuredWidth,
        height: modalFontSize * 1.3,
        text: replacementTextInput.trim(),
        fontSize: modalFontSize,
        fontFamily: modalFontFamily,
        color: modalTextColor,
        isBold: modalIsBold,
        isItalic: modalIsItalic,
        backgroundColor: modalBgColor,
        autoFit: false,
        yOffset: modalYOffset,
        inpaintPadding: modalInpaintPad,
      };

      setOverlays((prev) => [...prev, newOverlay]);
      setSelectedOverlayId(newOverlay.id);
    }

    setEditModalOpen(false);
    confetti({
      particleCount: 50,
      spread: 50,
      origin: { y: 0.6 },
    });
  };

  // ---------------------------------------------------------------------------
  // Canvas Click & Hover Interactions
  // ---------------------------------------------------------------------------

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const mouseX = (e.clientX - rect.left) * scaleX;
    const mouseY = (e.clientY - rect.top) * scaleY;

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
      return;
    }

    // Hover detection over OCR bounding boxes
    if (activeTool === 'editText' && currentOcrBlocks.length > 0) {
      const found = currentOcrBlocks.find(
        (b) =>
          mouseX >= b.bbox.x0 - 4 &&
          mouseX <= b.bbox.x1 + 4 &&
          mouseY >= b.bbox.y0 - 4 &&
          mouseY <= b.bbox.y1 + 4
      );

      if (found) {
        setHoveredBlockId(found.id);
        setCanvasTooltip({
          text: `Click to edit: "${found.text}" (${found.confidence}%)`,
          x: e.clientX,
          y: e.clientY - 35,
        });
      } else {
        setHoveredBlockId(null);
        setCanvasTooltip(null);
      }
    } else {
      setHoveredBlockId(null);
      setCanvasTooltip(null);
    }
  };

  const handleCanvasMouseLeave = () => {
    setHoveredBlockId(null);
    setCanvasTooltip(null);
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const clickX = (e.clientX - rect.left) * scaleX;
    const clickY = (e.clientY - rect.top) * scaleY;

    if (activeTool === 'editText') {
      // Find clicked OCR block
      const clickedBlock = currentOcrBlocks.find(
        (b) =>
          clickX >= b.bbox.x0 - 5 &&
          clickX <= b.bbox.x1 + 5 &&
          clickY >= b.bbox.y0 - 5 &&
          clickY <= b.bbox.y1 + 5
      );

      if (clickedBlock) {
        openEditModalFor(clickedBlock);
      } else {
        // If clicked on an existing overlay, open that
        const clickedOverlay = overlays.find(
          (o) =>
            clickX >= o.x - 5 &&
            clickX <= o.x + o.width + 5 &&
            clickY >= o.y - 5 &&
            clickY <= o.y + o.height + 5
        );
        if (clickedOverlay) {
          openEditModalForOverlay(clickedOverlay);
        } else {
          // Clicked empty area -> prompt to insert new text seamlessly
          openNewTextModalAt(clickX, clickY);
        }
      }
    } else if (activeTool === 'addText') {
      openNewTextModalAt(clickX, clickY);
    } else if (activeTool === 'erase') {
      const sampled = sampleImageTextAndBgColor(canvasRef.current || canvas, {
        x0: clickX - 25,
        y0: clickY - 10,
        x1: clickX + 25,
        y1: clickY + 10,
      });

      const newOverlay: ImageOverlayItem = {
        id: `erase-${Date.now()}`,
        x: Math.round(clickX - 45),
        y: Math.round(clickY - 15),
        originalWidth: 90,
        width: 90,
        height: 30,
        text: '',
        fontSize: 12,
        fontFamily: 'sans-serif',
        color: '#000000',
        isBold: false,
        isItalic: false,
        backgroundColor: sampled.bgColor,
        autoFit: false,
        yOffset: 0,
        inpaintPadding: 2,
        isEraser: true,
      };
      setOverlays((prev) => [...prev, newOverlay]);
      setSelectedOverlayId(newOverlay.id);
    } else if (activeTool === 'select') {
      const clicked = overlays.find(
        (o) =>
          clickX >= o.x - 5 &&
          clickX <= o.x + o.width + 5 &&
          clickY >= o.y - 5 &&
          clickY <= o.y + o.height + 5
      );
      setSelectedOverlayId(clicked ? clicked.id : null);
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

  // ---------------------------------------------------------------------------
  // Export Handlers
  // ---------------------------------------------------------------------------

  const handleExportImage = (format: 'png' | 'jpeg') => {
    if (!canvasRef.current) return;

    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = canvasRef.current.width;
    exportCanvas.height = canvasRef.current.height;
    const ectx = exportCanvas.getContext('2d');
    if (!ectx) return;

    // Draw base image
    ectx.drawImage(canvasRef.current, 0, 0);

    // Draw user modifications with clean typography
    for (const item of overlays) {
      if (item.isEraser) {
        ectx.fillStyle = item.backgroundColor;
        ectx.fillRect(item.x, item.y, item.width, item.height);
      } else {
        const layout = computeImageTextLayout(
          item.text,
          item.fontSize,
          item.fontFamily,
          item.isBold,
          item.isItalic,
          item.originalWidth,
          item.autoFit
        );

        const pad = item.inpaintPadding ?? 2;
        const patchWidth = item.autoFit
          ? Math.max(item.originalWidth, layout.measuredWidth)
          : Math.max(item.width, layout.measuredWidth);

        ectx.fillStyle = item.backgroundColor;
        ectx.fillRect(item.x - pad, item.y - pad, patchWidth + pad * 2, item.height + pad * 2);

        ectx.fillStyle = item.color;
        const fontStyle = `${item.isItalic ? 'italic ' : ''}${item.isBold ? 'bold ' : ''}${layout.fittedFontSize}px ${item.fontFamily}`;
        ectx.font = fontStyle;
        ectx.textBaseline = 'top';
        ectx.fillText(item.text, item.x, item.y + (item.yOffset || 0));
      }
    }

    const dataUrl = exportCanvas.toDataURL(`image/${format}`, 0.95);
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `Edited_${imageName.replace(/\.[^/.]+$/, '')}.${format === 'jpeg' ? 'jpg' : 'png'}`;
    a.click();

    confetti({
      particleCount: 80,
      spread: 60,
      origin: { y: 0.6 },
    });
  };

  const handleExportAsPdf = () => {
    if (!canvasRef.current) return;

    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = canvasRef.current.width;
    exportCanvas.height = canvasRef.current.height;
    const ectx = exportCanvas.getContext('2d');
    if (!ectx) return;

    ectx.drawImage(canvasRef.current, 0, 0);

    for (const item of overlays) {
      if (item.isEraser) {
        ectx.fillStyle = item.backgroundColor;
        ectx.fillRect(item.x, item.y, item.width, item.height);
      } else {
        const layout = computeImageTextLayout(
          item.text,
          item.fontSize,
          item.fontFamily,
          item.isBold,
          item.isItalic,
          item.originalWidth,
          item.autoFit
        );

        const pad = item.inpaintPadding ?? 2;
        const patchWidth = item.autoFit
          ? Math.max(item.originalWidth, layout.measuredWidth)
          : Math.max(item.width, layout.measuredWidth);

        ectx.fillStyle = item.backgroundColor;
        ectx.fillRect(item.x - pad, item.y - pad, patchWidth + pad * 2, item.height + pad * 2);

        ectx.fillStyle = item.color;
        const fontStyle = `${item.isItalic ? 'italic ' : ''}${item.isBold ? 'bold ' : ''}${layout.fittedFontSize}px ${item.fontFamily}`;
        ectx.font = fontStyle;
        ectx.textBaseline = 'top';
        ectx.fillText(item.text, item.x, item.y + (item.yOffset || 0));
      }
    }

    const imgData = exportCanvas.toDataURL('image/jpeg', 0.95);
    const pdf = new jsPDF({
      orientation: exportCanvas.width > exportCanvas.height ? 'landscape' : 'portrait',
      unit: 'px',
      format: [exportCanvas.width, exportCanvas.height],
    });

    pdf.addImage(imgData, 'JPEG', 0, 0, exportCanvas.width, exportCanvas.height);
    const blob = pdf.output('blob');

    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = `Edited_${imageName.replace(/\.[^/.]+$/, '')}.pdf`;
    a.click();

    confetti({
      particleCount: 80,
      spread: 60,
      origin: { y: 0.6 },
    });
  };

  return (
    <div className="responsive-container">
      {/* Floating Canvas Tooltip */}
      {canvasTooltip && (
        <div
          style={{
            position: 'fixed',
            left: `${canvasTooltip.x + 12}px`,
            top: `${canvasTooltip.y}px`,
            pointerEvents: 'none',
            zIndex: 9999,
            background: 'rgba(15, 23, 42, 0.92)',
            color: '#f8fafc',
            padding: '4px 8px',
            borderRadius: '6px',
            fontSize: '0.78rem',
            border: '1px solid rgba(99, 102, 241, 0.4)',
            backdropFilter: 'blur(8px)',
            boxShadow: '0 4px 14px rgba(0,0,0,0.4)',
            whiteSpace: 'nowrap',
          }}
        >
          {canvasTooltip.text}
        </div>
      )}

      {/* Header Bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '1.2rem',
          flexWrap: 'wrap',
          gap: '1rem',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <h2 style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--text-primary)' }}>
              Image Text & Neural OCR Editor
            </h2>
            <span
              style={{
                fontSize: '0.7rem',
                padding: '2px 8px',
                borderRadius: '9999px',
                background: 'rgba(6, 182, 212, 0.15)',
                color: '#67e8f9',
                border: '1px solid rgba(6, 182, 212, 0.3)',
                fontWeight: 700,
              }}
            >
              Client-Side AI
            </span>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '0.2rem' }}>
            Click directly on any detected text in your image or select from the sidebar to replace words seamlessly.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button onClick={handleLoadSampleReceipt} className="btn btn-secondary">
            <Scan size={15} />
            Try Sample Receipt
          </button>
        </div>
      </div>

      {!imageUrl ? (
        /* Image Upload Dropzone */
        <div
          className="dropzone glass-panel"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files[0]) handleLoadImage(e.dataTransfer.files[0]);
          }}
          onClick={() => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.onchange = (e) => {
              const target = e.target as HTMLInputElement;
              if (target.files?.[0]) handleLoadImage(target.files[0]);
            };
            input.click();
          }}
        >
          <div className="dropzone-icon-ring">
            <Scan size={26} />
          </div>
          <div>
            <h3 style={{ fontSize: '1.15rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
              Choose an image or drop it here
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
              Supports receipts, certificates, documents, PNG, JPEG, WEBP. Neural OCR auto-runs locally.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.25rem' }}>
            <span className="btn btn-primary">
              Browse Image
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleLoadSampleReceipt();
              }}
              className="btn btn-secondary"
            >
              Try Sample Receipt
            </button>
          </div>
        </div>
      ) : (
        /* Active Workspace */
        <div>
          {/* Main Action Toolbar */}
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
            {/* Tool Selection */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                onClick={() => runOcrOnUrl(imageUrl)}
                disabled={isScanningOcr}
                className="btn btn-primary"
                style={{ background: 'var(--grad-cyan)', color: '#ffffff' }}
              >
                {isScanningOcr ? (
                  <>
                    <div className="spinner" /> Scanning OCR ({ocrProgress}%)...
                  </>
                ) : (
                  <>
                    <Scan size={16} /> Re-Scan Image OCR
                  </>
                )}
              </button>

              <button
                onClick={() => setActiveTool('editText')}
                className={`btn ${activeTool === 'editText' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ padding: '0.45rem 0.85rem', fontSize: '0.85rem' }}
                title="Click any text box on the image to edit"
              >
                <Edit3 size={15} /> Click Text to Edit
              </button>

              <button
                onClick={() => setActiveTool('addText')}
                className={`btn ${activeTool === 'addText' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ padding: '0.45rem 0.85rem', fontSize: '0.85rem' }}
                title="Click canvas to insert new text"
              >
                <Type size={15} /> Add New Text
              </button>

              <button
                onClick={() => setActiveTool('erase')}
                className={`btn ${activeTool === 'erase' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ padding: '0.45rem 0.85rem', fontSize: '0.85rem' }}
                title="Click canvas to erase/inpaint area"
              >
                <Eraser size={15} /> Erase Area
              </button>

              <button
                onClick={() => setActiveTool('select')}
                className={`btn ${activeTool === 'select' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ padding: '0.45rem 0.85rem', fontSize: '0.85rem' }}
                title="Select and drag overlays"
              >
                <Move size={15} /> Move
              </button>

              <div style={{ width: '1px', height: '24px', background: 'var(--border-subtle)', margin: '0 0.25rem' }} />

              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  fontSize: '0.82rem',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  userSelect: 'none',
                }}
              >
                <input
                  type="checkbox"
                  checked={showBoundingBoxes}
                  onChange={(e) => setShowBoundingBoxes(e.target.checked)}
                  style={{ accentColor: '#6366f1' }}
                />
                <span>Show Detection Boxes ({currentOcrBlocks.length})</span>
              </label>
            </div>

            {/* Export Actions */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <button
                onClick={() => {
                  setImageUrl('');
                  setOverlays([]);
                  setOcrWordBlocks([]);
                  setOcrLineBlocks([]);
                }}
                className="btn btn-secondary"
                style={{ padding: '0.45rem 0.75rem', fontSize: '0.8rem' }}
                title="Upload different image"
              >
                <RotateCcw size={14} /> New Image
              </button>

              <button onClick={() => handleExportImage('png')} className="btn btn-emerald" style={{ padding: '0.5rem 0.95rem' }}>
                <Download size={15} /> Save PNG
              </button>

              <button onClick={handleExportAsPdf} className="btn btn-secondary" style={{ padding: '0.5rem 0.95rem' }}>
                <FileText size={15} /> Export PDF
              </button>
            </div>
          </div>

          {/* OCR Progress Banner if running */}
          {isScanningOcr && (
            <div className="glass-panel" style={{ padding: '0.8rem 1.2rem', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.3rem', color: '#67e8f9' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Sparkles size={14} /> {ocrStatus}
                </span>
                <span style={{ fontWeight: 700 }}>{ocrProgress}%</span>
              </div>
              <div style={{ height: '6px', background: 'var(--bg-secondary)', borderRadius: '9999px', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${ocrProgress}%`, background: 'var(--grad-cyan)', transition: 'width 0.2s ease' }} />
              </div>
            </div>
          )}

          {/* Tips bar */}
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
              flexWrap: 'wrap',
              gap: '0.5rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <CheckCircle2 size={15} color="var(--primary)" />
              <span>
                {currentOcrBlocks.length > 0
                  ? `Detected ${currentOcrBlocks.length} text blocks. Click any highlighted box on the image or use the sidebar list to edit.`
                  : 'Image ready. Click anywhere on the canvas to add or edit text.'}
              </span>
            </div>

            {overlays.length > 0 && (
              <span className="badge badge-emerald">
                ✓ {overlays.length} active text edit{overlays.length > 1 ? 's' : ''} applied
              </span>
            )}
          </div>

          {/* Main Workspace Grid: Canvas on Left, Detected Text Sidebar on Right */}
          <div className="editor-grid">
            {/* Left: Interactive Canvas Container */}
            <div
              className="workspace-canvas-wrapper"
              style={{
                overflowX: 'auto',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'flex-start',
              }}
            >
              <div
                style={{
                  position: 'relative',
                  boxShadow: 'var(--shadow-lg)',
                  borderRadius: '6px',
                  overflow: 'hidden',
                  maxWidth: '100%',
                }}
              >
                <canvas ref={canvasRef} style={{ display: 'block', maxWidth: '100%', height: 'auto' }} />
                <canvas
                  ref={overlayCanvasRef}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    cursor:
                      activeTool === 'editText'
                        ? hoveredBlockId
                          ? 'pointer'
                          : 'crosshair'
                        : activeTool === 'select'
                        ? 'default'
                        : 'crosshair',
                  }}
                  onClick={handleCanvasClick}
                  onMouseMove={handleCanvasMouseMove}
                  onMouseLeave={handleCanvasMouseLeave}
                  onMouseDown={handleMouseDown}
                  onMouseUp={handleMouseUp}
                />
              </div>
            </div>

            {/* Right: Sidebar with Detected Text & Applied Edits */}
            <div
              className="glass-panel editor-sidebar"
              style={{
                padding: '1rem',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              {/* Sidebar Tabs */}
              <div
                style={{
                  display: 'flex',
                  background: 'var(--bg-secondary)',
                  padding: '3px',
                  borderRadius: 'var(--radius-md)',
                  marginBottom: '0.85rem',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <button
                  onClick={() => setSidebarTab('detected')}
                  style={{
                    flex: 1,
                    padding: '0.45rem',
                    border: 'none',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    background: sidebarTab === 'detected' ? 'var(--grad-primary)' : 'transparent',
                    color: sidebarTab === 'detected' ? '#ffffff' : 'var(--text-secondary)',
                    transition: 'all 0.15s ease',
                  }}
                >
                  Detected Text ({currentOcrBlocks.length})
                </button>
                <button
                  onClick={() => setSidebarTab('applied')}
                  style={{
                    flex: 1,
                    padding: '0.45rem',
                    border: 'none',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    background: sidebarTab === 'applied' ? 'var(--grad-primary)' : 'transparent',
                    color: sidebarTab === 'applied' ? '#ffffff' : 'var(--text-secondary)',
                    transition: 'all 0.15s ease',
                  }}
                >
                  Applied Edits ({overlays.length})
                </button>
              </div>

              {sidebarTab === 'detected' ? (
                /* Detected Text List */
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
                  {/* Controls: Search + Granularity */}
                  <div style={{ marginBottom: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <div style={{ position: 'relative' }}>
                      <Search
                        size={14}
                        style={{ position: 'absolute', left: '10px', top: '10px', color: 'var(--text-muted)' }}
                      />
                      <input
                        type="text"
                        placeholder="Search detected words..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="input-text"
                        style={{
                          width: '100%',
                          paddingLeft: '32px',
                          paddingTop: '0.45rem',
                          paddingBottom: '0.45rem',
                          fontSize: '0.82rem',
                        }}
                      />
                      {searchQuery && (
                        <button
                          onClick={() => setSearchQuery('')}
                          style={{
                            position: 'absolute',
                            right: '8px',
                            top: '8px',
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--text-muted)',
                            cursor: 'pointer',
                          }}
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>

                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Granularity:</span>
                      <button
                        onClick={() => setOcrGranularity('words')}
                        className={`btn ${ocrGranularity === 'words' ? 'btn-primary' : 'btn-secondary'}`}
                        style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}
                      >
                        Single Words ({ocrWordBlocks.length})
                      </button>
                      <button
                        onClick={() => setOcrGranularity('lines')}
                        className={`btn ${ocrGranularity === 'lines' ? 'btn-primary' : 'btn-secondary'}`}
                        style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}
                      >
                        Full Lines ({ocrLineBlocks.length})
                      </button>
                    </div>
                  </div>

                  {/* Scrollable list of detected words/lines */}
                  <div
                    style={{
                      flex: 1,
                      overflowY: 'auto',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.45rem',
                      paddingRight: '4px',
                    }}
                  >
                    {filteredOcrBlocks.length === 0 ? (
                      <div
                        style={{
                          textAlign: 'center',
                          padding: '2.5rem 1rem',
                          color: 'var(--text-muted)',
                          fontSize: '0.85rem',
                        }}
                      >
                        {isScanningOcr ? (
                          <>
                            <div className="spinner" style={{ margin: '0 auto 0.75rem auto' }} />
                            <span>Reading text in image...</span>
                          </>
                        ) : (
                          <>
                            <AlertCircle size={28} style={{ margin: '0 auto 0.5rem auto', opacity: 0.5 }} />
                            <span>{searchQuery ? 'No matching text found' : 'No OCR text detected yet'}</span>
                          </>
                        )}
                      </div>
                    ) : (
                      filteredOcrBlocks.map((block) => {
                        const isHovered = hoveredBlockId === block.id;
                        return (
                          <div
                            key={block.id}
                            onMouseEnter={() => setHoveredBlockId(block.id)}
                            onMouseLeave={() => setHoveredBlockId(null)}
                            style={{
                              background: isHovered ? 'rgba(99, 102, 241, 0.16)' : 'rgba(255, 255, 255, 0.03)',
                              border: isHovered ? '1px solid #6366f1' : '1px solid var(--border-subtle)',
                              borderRadius: 'var(--radius-md)',
                              padding: '0.55rem 0.75rem',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: '0.5rem',
                              transition: 'all 0.15s ease',
                            }}
                          >
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div
                                style={{
                                  fontSize: '0.85rem',
                                  fontWeight: 600,
                                  color: 'var(--text-primary)',
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                }}
                                title={block.text}
                              >
                                {block.text}
                              </div>
                              <div
                                style={{
                                  fontSize: '0.72rem',
                                  color: 'var(--text-muted)',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '0.4rem',
                                  marginTop: '2px',
                                }}
                              >
                                <span
                                  style={{
                                    color: block.confidence > 80 ? '#10b981' : '#f59e0b',
                                  }}
                                >
                                  {block.confidence}% match
                                </span>
                                <span>•</span>
                                <span>
                                  {Math.round(block.bbox.x1 - block.bbox.x0)}×{Math.round(block.bbox.y1 - block.bbox.y0)}px
                                </span>
                              </div>
                            </div>

                            <div style={{ display: 'flex', gap: '0.3rem' }}>
                              <button
                                onClick={() => openEditModalFor(block)}
                                className="btn btn-primary"
                                style={{
                                  padding: '0.35rem 0.65rem',
                                  fontSize: '0.75rem',
                                  background: 'var(--grad-primary)',
                                }}
                                title="Edit this text"
                              >
                                <Edit3 size={12} /> Edit
                              </button>
                              <button
                                onClick={() => handleEraseOriginalBlock(block)}
                                className="btn-icon"
                                style={{ padding: '0.35rem' }}
                                title="Erase original word from image"
                              >
                                <Eraser size={13} />
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              ) : (
                /* Applied Edits List */
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
                  <div
                    style={{
                      flex: 1,
                      overflowY: 'auto',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.5rem',
                      paddingRight: '4px',
                    }}
                  >
                    {overlays.length === 0 ? (
                      <div
                        style={{
                          textAlign: 'center',
                          padding: '3rem 1rem',
                          color: 'var(--text-muted)',
                          fontSize: '0.85rem',
                        }}
                      >
                        <Type size={32} style={{ margin: '0 auto 0.5rem auto', opacity: 0.4 }} />
                        <p>No edits applied yet.</p>
                        <p style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>
                          Click any detected text box on the image to edit and inpaint replacement words!
                        </p>
                      </div>
                    ) : (
                      overlays.map((item, idx) => (
                        <div
                          key={item.id}
                          style={{
                            background: selectedOverlayId === item.id ? 'rgba(99, 102, 241, 0.16)' : 'rgba(255, 255, 255, 0.03)',
                            border: selectedOverlayId === item.id ? '1px solid #6366f1' : '1px solid var(--border-subtle)',
                            borderRadius: 'var(--radius-md)',
                            padding: '0.65rem 0.75rem',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.3rem' }}>
                            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#a5b4fc' }}>
                              #{idx + 1} {item.isEraser ? 'Erased Patch' : 'Text Edit'}
                            </span>
                            <div style={{ display: 'flex', gap: '0.3rem' }}>
                              {!item.isEraser && (
                                <button
                                  onClick={() => openEditModalForOverlay(item)}
                                  className="btn-icon"
                                  style={{ padding: '0.3rem' }}
                                  title="Edit text"
                                >
                                  <Edit3 size={12} />
                                </button>
                              )}
                              <button
                                onClick={() => setOverlays((prev) => prev.filter((o) => o.id !== item.id))}
                                className="btn-icon"
                                style={{ padding: '0.3rem', color: '#fb7185' }}
                                title="Delete edit"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          </div>

                          {item.originalText && (
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textDecoration: 'line-through' }}>
                              "{item.originalText}"
                            </div>
                          )}

                          {!item.isEraser && (
                            <div style={{ fontSize: '0.88rem', fontWeight: 600, color: item.color, marginTop: '2px' }}>
                              "{item.text}"
                            </div>
                          )}

                          <div
                            style={{
                              display: 'flex',
                              gap: '0.5rem',
                              alignItems: 'center',
                              fontSize: '0.72rem',
                              color: 'var(--text-muted)',
                              marginTop: '4px',
                            }}
                          >
                            <span>{item.fontSize}px</span>
                            <span>•</span>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                              <span
                                style={{
                                  width: '9px',
                                  height: '9px',
                                  borderRadius: '2px',
                                  background: item.backgroundColor,
                                  border: '1px solid rgba(255,255,255,0.2)',
                                }}
                              />
                              Fill
                            </span>
                            {!item.isEraser && (
                              <>
                                <span>•</span>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                                  <span
                                    style={{
                                      width: '9px',
                                      height: '9px',
                                      borderRadius: '2px',
                                      background: item.color,
                                      border: '1px solid rgba(255,255,255,0.2)',
                                    }}
                                  />
                                  Text
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  {overlays.length > 0 && (
                    <button
                      onClick={() => setOverlays([])}
                      className="btn btn-secondary"
                      style={{ marginTop: '0.75rem', width: '100%', fontSize: '0.8rem', color: '#fb7185' }}
                    >
                      <Trash2 size={13} /> Revert All Edits
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------------- */}
      {/* Visual In-Place Edit Modal (Replaces window.prompt)                   */}
      {/* ---------------------------------------------------------------------- */}
      {editModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(5, 7, 12, 0.75)',
            backdropFilter: 'blur(10px)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setEditModalOpen(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setEditModalOpen(false);
          }}
        >
          <div
            className="glass-panel"
            style={{
              width: '100%',
              maxWidth: '520px',
              padding: '1.5rem',
              borderRadius: 'var(--radius-lg)',
              boxShadow: '0 24px 60px rgba(0, 0, 0, 0.7)',
              border: '1px solid rgba(99, 102, 241, 0.3)',
              background: 'linear-gradient(180deg, rgba(22, 29, 47, 0.96) 0%, rgba(13, 18, 30, 0.98) 100%)',
              maxHeight: '92vh',
              overflowY: 'auto',
            }}
          >
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.2rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <div
                  style={{
                    width: '34px',
                    height: '34px',
                    borderRadius: 'var(--radius-md)',
                    background: 'rgba(99, 102, 241, 0.2)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#818cf8',
                  }}
                >
                  <Edit3 size={18} />
                </div>
                <div>
                  <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    {targetBlockToEdit ? 'Edit Detected Image Text' : editingOverlayId ? 'Update Edited Text' : 'Insert New Image Text'}
                  </h3>
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                    Auto-inpaints matching background and renders live typography
                  </p>
                </div>
              </div>

              <button
                onClick={() => setEditModalOpen(false)}
                className="btn-icon"
                style={{ borderRadius: 'var(--radius-full)' }}
              >
                <X size={16} />
              </button>
            </div>

            {/* Original Text Pill if replacing */}
            {targetBlockToEdit && (
              <div
                style={{
                  background: 'rgba(0,0,0,0.3)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  padding: '0.6rem 0.85rem',
                  marginBottom: '1rem',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Original Text
                  </span>
                  <span style={{ fontSize: '0.92rem', fontWeight: 600, color: '#e2e8f0' }}>
                    "{targetBlockToEdit.text}"
                  </span>
                </div>
                <span
                  style={{
                    fontSize: '0.72rem',
                    padding: '2px 8px',
                    borderRadius: '9999px',
                    background: 'rgba(16, 185, 129, 0.15)',
                    color: '#34d399',
                    border: '1px solid rgba(16, 185, 129, 0.3)',
                    fontWeight: 600,
                  }}
                >
                  {targetBlockToEdit.confidence}% Confidence
                </span>
              </div>
            )}

            {/* Replacement Textarea */}
            <div style={{ marginBottom: '1.1rem' }}>
              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
                Replacement Text
              </label>
              <textarea
                ref={textInputRef}
                value={replacementTextInput}
                onChange={(e) => setReplacementTextInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleApplyModalEdit();
                  }
                }}
                rows={2}
                className="input-text"
                style={{
                  width: '100%',
                  fontSize: '1rem',
                  fontWeight: modalIsBold ? 700 : 400,
                  fontStyle: modalIsItalic ? 'italic' : 'normal',
                  fontFamily: modalFontFamily,
                  color: modalTextColor,
                  backgroundColor: 'rgba(15, 23, 42, 0.6)',
                  resize: 'none',
                }}
                placeholder="Type new text here..."
              />
            </div>

            {/* Smart Typography & Inpaint Settings */}
            <div
              style={{
                background: 'rgba(0, 0, 0, 0.25)',
                borderRadius: 'var(--radius-md)',
                padding: '0.9rem',
                border: '1px solid var(--border-subtle)',
                marginBottom: '1.25rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.8rem',
              }}
            >
              {/* Row 1: Font Family & Font Size */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: '0.75rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                    Font Style
                  </label>
                  <select
                    value={modalFontFamily}
                    onChange={(e) => setModalFontFamily(e.target.value)}
                    className="select-input"
                    style={{ width: '100%', fontSize: '0.82rem', padding: '0.45rem' }}
                  >
                    <option value="'Plus Jakarta Sans', sans-serif">Modern Sans-Serif</option>
                    <option value="'Times New Roman', Georgia, serif">Classic Serif</option>
                    <option value="'JetBrains Mono', monospace">Monospace Code</option>
                    <option value="Arial, Helvetica, sans-serif">Standard Arial</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                    Font Size ({modalFontSize}px)
                  </label>
                  <input
                    type="range"
                    min={10}
                    max={48}
                    value={modalFontSize}
                    onChange={(e) => setModalFontSize(Number(e.target.value))}
                    style={{ width: '100%', accentColor: '#6366f1', marginTop: '6px' }}
                  />
                </div>
              </div>

              {/* Row 2: Colors & Toggles */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
                {/* Text Color */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Text Color:</span>
                  <input
                    type="color"
                    value={modalTextColor}
                    onChange={(e) => setModalTextColor(e.target.value)}
                    style={{
                      width: '30px',
                      height: '30px',
                      borderRadius: '6px',
                      border: '1px solid var(--border-subtle)',
                      background: 'transparent',
                      cursor: 'pointer',
                    }}
                  />
                </div>

                {/* Background Fill Color */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Erase Fill:</span>
                  <input
                    type="color"
                    value={modalBgColor}
                    onChange={(e) => setModalBgColor(e.target.value)}
                    style={{
                      width: '30px',
                      height: '30px',
                      borderRadius: '6px',
                      border: '1px solid var(--border-subtle)',
                      background: 'transparent',
                      cursor: 'pointer',
                    }}
                  />
                </div>

                {/* Bold & Italic */}
                <div style={{ display: 'flex', gap: '0.3rem' }}>
                  <button
                    type="button"
                    onClick={() => setModalIsBold(!modalIsBold)}
                    className={`btn-icon ${modalIsBold ? 'active' : ''}`}
                    style={{
                      width: '30px',
                      height: '30px',
                      fontWeight: 700,
                      background: modalIsBold ? 'rgba(99, 102, 241, 0.25)' : undefined,
                      color: modalIsBold ? '#a5b4fc' : undefined,
                    }}
                  >
                    B
                  </button>
                  <button
                    type="button"
                    onClick={() => setModalIsItalic(!modalIsItalic)}
                    className={`btn-icon ${modalIsItalic ? 'active' : ''}`}
                    style={{
                      width: '30px',
                      height: '30px',
                      fontStyle: 'italic',
                      background: modalIsItalic ? 'rgba(99, 102, 241, 0.25)' : undefined,
                      color: modalIsItalic ? '#a5b4fc' : undefined,
                    }}
                  >
                    I
                  </button>
                </div>
              </div>

              {/* Row 3: Auto-Fit Toggle & Margin Padding */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingTop: '0.4rem',
                  borderTop: '1px solid rgba(255, 255, 255, 0.05)',
                  flexWrap: 'wrap',
                  gap: '0.5rem',
                }}
              >
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={modalAutoFit}
                    onChange={(e) => setModalAutoFit(e.target.checked)}
                    style={{ accentColor: '#10b981' }}
                  />
                  <span>Auto-Fit (Prevents overlapping neighbor text)</span>
                </label>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Padding:</span>
                  <input
                    type="range"
                    min={0}
                    max={6}
                    value={modalInpaintPad}
                    onChange={(e) => setModalInpaintPad(Number(e.target.value))}
                    style={{ width: '60px', accentColor: '#6366f1' }}
                    title="Inpaint mask padding"
                  />
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{modalInpaintPad}px</span>
                </div>
              </div>
            </div>

            {/* Modal Actions */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
              {targetBlockToEdit ? (
                <button
                  type="button"
                  onClick={() => {
                    handleEraseOriginalBlock(targetBlockToEdit);
                    setEditModalOpen(false);
                  }}
                  className="btn btn-secondary"
                  style={{ fontSize: '0.82rem', padding: '0.55rem 0.9rem', color: '#fb7185' }}
                >
                  <Eraser size={14} /> Erase Original Only
                </button>
              ) : (
                <div />
              )}

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => setEditModalOpen(false)}
                  className="btn btn-secondary"
                  style={{ fontSize: '0.85rem' }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleApplyModalEdit}
                  className="btn btn-primary"
                  style={{ fontSize: '0.85rem', background: 'var(--grad-primary)' }}
                >
                  <CheckCircle2 size={15} /> Save & Apply
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

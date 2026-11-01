import * as pdfjsLib from 'pdfjs-dist';

// Configure the worker source to use local worker served from public/ or CDN fallback
if (typeof window !== 'undefined') {
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.mjs';
  } catch (err) {
    console.warn('Failed to set local pdf.worker, fallbacking to CDN', err);
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
  }
}

export const PDFJS_DEFAULT_CONFIG = {
  cMapUrl: '/cmaps/',
  cMapPacked: true,
  standardFontDataUrl: '/standard_fonts/',
  iccUrl: '/iccs/',
  wasmUrl: '/wasm/',
  useWasm: true,
  useWorkerFetch: true,
};

export { pdfjsLib };

import React, { useState, useRef, useEffect } from 'react';
import { 
  FileText, 
  ArrowRightLeft, 
  Download, 
  Upload, 
  CheckCircle2, 
  RefreshCw, 
  Copy, 
  FileCheck, 
  FileType, 
  Settings2,
  ZoomIn,
  ZoomOut,
  Maximize2
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { convertDocxToHtml, exportHtmlToPdf, createSampleDocx } from '../../utils/wordToPdf';
import { convertPdfToWord, createSamplePdf } from '../../utils/pdfToWord';

export const WordPdfConverter: React.FC = () => {
  const [activeMode, setActiveMode] = useState<'wordToPdf' | 'pdfToWord'>('wordToPdf');

  // Word -> PDF state
  const [wordFile, setWordFile] = useState<File | null>(null);
  const [wordHtml, setWordHtml] = useState<string>('');
  const [isConvertingDocx, setIsConvertingDocx] = useState(false);
  const [docxPdfBlob, setDocxPdfBlob] = useState<Blob | null>(null);
  const [pageSize, setPageSize] = useState<'a4' | 'letter'>('a4');
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait');
  const previewRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Responsive Zoom & Viewport state for Word preview
  const [docZoom, setDocZoom] = useState<number | 'fit'>('fit');
  const [containerWidth, setContainerWidth] = useState<number>(850);
  const [previewHeight, setPreviewHeight] = useState<number>(1000);

  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.clientWidth);
      }
      if (previewRef.current) {
        setPreviewHeight(previewRef.current.offsetHeight || 1000);
      }
    };
    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    const observer = new ResizeObserver(updateDimensions);
    if (containerRef.current) observer.observe(containerRef.current);
    if (previewRef.current) observer.observe(previewRef.current);
    return () => {
      window.removeEventListener('resize', updateDimensions);
      observer.disconnect();
    };
  }, [wordHtml, orientation]);

  const baseDocWidth = orientation === 'portrait' ? 794 : 1123;
  const autoScale = Math.min(1.0, Math.max(0.28, (containerWidth - 32) / baseDocWidth));
  const currentScale = typeof docZoom === 'number' ? docZoom : autoScale;

  // PDF -> Word state
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [isExtractingPdf, setIsExtractingPdf] = useState(false);
  const [extractionProgress, setExtractionProgress] = useState(0);
  const [extractionStatus, setExtractionStatus] = useState('');
  const [extractedResult, setExtractedResult] = useState<Awaited<ReturnType<typeof convertPdfToWord>> | null>(null);

  // Handle Word file upload
  const handleWordUpload = async (file: File) => {
    setWordFile(file);
    setDocxPdfBlob(null);
    setIsConvertingDocx(true);
    try {
      const buffer = await file.arrayBuffer();
      const result = await convertDocxToHtml(buffer);
      setWordHtml(result.html);
    } catch (err) {
      console.error('Failed to parse docx:', err);
      alert('Error reading Word file. Please verify it is a valid .docx document.');
    } finally {
      setIsConvertingDocx(false);
    }
  };

  // Convert rendered Word HTML preview into downloadable PDF
  const handleExportWordToPdf = async () => {
    if (!previewRef.current) return;
    setIsConvertingDocx(true);
    const originalTransform = previewRef.current.style.transform;
    previewRef.current.style.transform = 'none';
    try {
      const pdfBlob = await exportHtmlToPdf(previewRef.current, {
        pageSize,
        orientation,
        margins: 12,
      });
      setDocxPdfBlob(pdfBlob);
      confetti({
        particleCount: 80,
        spread: 60,
        origin: { y: 0.6 },
      });
    } catch (err) {
      console.error('Failed to export PDF:', err);
      alert('Failed to generate PDF. Please try again.');
    } finally {
      if (previewRef.current) {
        previewRef.current.style.transform = originalTransform;
      }
      setIsConvertingDocx(false);
    }
  };

  // Load sample Word document
  const handleLoadSampleWord = async () => {
    setIsConvertingDocx(true);
    try {
      const sampleBlob = await createSampleDocx();
      const sampleFile = new File([sampleBlob], 'Sample_Executive_Report.docx', {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
      await handleWordUpload(sampleFile);
    } finally {
      setIsConvertingDocx(false);
    }
  };

  // Handle PDF file upload
  const handlePdfUpload = async (file: File) => {
    setPdfFile(file);
    setExtractedResult(null);
    setIsExtractingPdf(true);
    try {
      const buffer = await file.arrayBuffer();
      const result = await convertPdfToWord(buffer, (prog, stat) => {
        setExtractionProgress(prog);
        setExtractionStatus(stat);
      });
      setExtractedResult(result);
      confetti({
        particleCount: 80,
        spread: 60,
        origin: { y: 0.6 },
      });
    } catch (err) {
      console.error('PDF extraction failed:', err);
      alert('Failed to parse PDF document. Please make sure the file contains extractable text.');
    } finally {
      setIsExtractingPdf(false);
    }
  };

  // Load sample PDF
  const handleLoadSamplePdf = async () => {
    setIsExtractingPdf(true);
    try {
      const sampleBlob = await createSamplePdf();
      const sampleFile = new File([sampleBlob], 'Sample_Roadmap_Spec.pdf', {
        type: 'application/pdf',
      });
      await handlePdfUpload(sampleFile);
    } finally {
      setIsExtractingPdf(false);
    }
  };

  return (
    <div className="responsive-container">
      {/* Sub-mode selector */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '2rem' }}>
        <div
          style={{
            display: 'flex',
            background: 'var(--bg-tertiary)',
            padding: '3px',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border-subtle)',
            gap: '4px',
          }}
        >
          <button
            onClick={() => setActiveMode('wordToPdf')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.55rem 1.2rem',
              borderRadius: 'var(--radius-md)',
              border: '1px solid ' + (activeMode === 'wordToPdf' ? 'var(--border-subtle)' : 'transparent'),
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '0.85rem',
              transition: 'all 0.15s ease',
              background: activeMode === 'wordToPdf' ? 'var(--bg-secondary)' : 'transparent',
              color: activeMode === 'wordToPdf' ? 'var(--text-primary)' : 'var(--text-secondary)',
              boxShadow: activeMode === 'wordToPdf' ? 'var(--shadow-sm)' : 'none',
            }}
          >
            <FileType size={16} />
            Word to PDF (.docx → .pdf)
          </button>

          <button
            onClick={() => setActiveMode('pdfToWord')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.55rem 1.2rem',
              borderRadius: 'var(--radius-md)',
              border: '1px solid ' + (activeMode === 'pdfToWord' ? 'var(--border-subtle)' : 'transparent'),
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '0.85rem',
              transition: 'all 0.15s ease',
              background: activeMode === 'pdfToWord' ? 'var(--bg-secondary)' : 'transparent',
              color: activeMode === 'pdfToWord' ? 'var(--text-primary)' : 'var(--text-secondary)',
              boxShadow: activeMode === 'pdfToWord' ? 'var(--shadow-sm)' : 'none',
            }}
          >
            <ArrowRightLeft size={16} />
            PDF to Word (.pdf → .docx)
          </button>
        </div>
      </div>

      {/* 1. WORD TO PDF TAB */}
      {activeMode === 'wordToPdf' && (
        <div>
          {/* Header & Quick Sample */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
                Word to PDF Converter
              </h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '0.2rem' }}>
                Convert Microsoft Word (.docx) files into clean, vector-accurate PDF documents in your browser.
              </p>
            </div>
            <button
              onClick={handleLoadSampleWord}
              disabled={isConvertingDocx}
              className="btn btn-secondary"
            >
              <FileText size={15} />
              Try Sample Word Doc
            </button>
          </div>

          {!wordHtml ? (
            /* Upload Dropzone */
            <div
              className="dropzone glass-panel"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (e.dataTransfer.files[0]) handleWordUpload(e.dataTransfer.files[0]);
              }}
              onClick={() => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = '.docx';
                input.onchange = (e) => {
                  const target = e.target as HTMLInputElement;
                  if (target.files?.[0]) handleWordUpload(target.files[0]);
                };
                input.click();
              }}
            >
              <div className="dropzone-icon-ring">
                <Upload size={30} />
              </div>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 700 }}>Choose a Word (.docx) document or drop it here</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                Supports Microsoft Word 2007+ files with headings, tables, formatting & bullet lists
              </p>
              <span className="btn btn-primary" style={{ marginTop: '0.5rem' }}>
                Browse Files
              </span>
            </div>
          ) : (
            /* Document Preview & Controls */
            <div>
              {/* Action & Options Bar */}
              <div
                className="glass-panel"
                style={{
                  padding: '1rem 1.5rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '1.5rem',
                  flexWrap: 'wrap',
                  gap: '1rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <div className="badge badge-blue">
                    <FileCheck size={14} />
                    {wordFile?.name || 'Document.docx'}
                  </div>
                  <button
                    onClick={() => {
                      setWordFile(null);
                      setWordHtml('');
                      setDocxPdfBlob(null);
                    }}
                    className="btn btn-secondary"
                    style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
                  >
                    <RefreshCw size={14} /> Change File
                  </button>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                  {/* Page settings */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Settings2 size={16} color="var(--text-secondary)" />
                    <select
                      value={pageSize}
                      onChange={(e) => setPageSize(e.target.value as 'a4' | 'letter')}
                      className="select-input"
                    >
                      <option value="a4">A4 Standard</option>
                      <option value="letter">US Letter</option>
                    </select>

                    <select
                      value={orientation}
                      onChange={(e) => setOrientation(e.target.value as 'portrait' | 'landscape')}
                      className="select-input"
                    >
                      <option value="portrait">Portrait</option>
                      <option value="landscape">Landscape</option>
                    </select>
                  </div>

                  <button
                    onClick={handleExportWordToPdf}
                    disabled={isConvertingDocx}
                    className="btn btn-primary"
                  >
                    {isConvertingDocx ? (
                      <>
                        <div className="spinner" /> Generating PDF...
                      </>
                    ) : (
                      <>
                        <FileText size={16} /> Convert to PDF
                      </>
                    )}
                  </button>

                  {docxPdfBlob && (
                    <a
                      href={URL.createObjectURL(docxPdfBlob)}
                      download={`${wordFile?.name.replace(/\.docx$/i, '') || 'document'}.pdf`}
                      className="btn btn-emerald"
                    >
                      <Download size={16} /> Download PDF
                    </a>
                  )}
                </div>
              </div>

              {/* Document Viewport & Zoom Toolbar */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                  padding: '0.6rem 0.9rem',
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  marginBottom: '1rem',
                  flexWrap: 'wrap',
                  gap: '0.6rem',
                  boxShadow: 'var(--shadow-sm)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                  <button
                    onClick={() => setDocZoom((prev) => typeof prev === 'number' ? Math.max(0.3, Number((prev - 0.15).toFixed(2))) : Math.max(0.3, Number((autoScale - 0.15).toFixed(2))))}
                    className="btn-icon"
                    title="Zoom Out"
                  >
                    <ZoomOut size={15} />
                  </button>

                  <span style={{ fontSize: '0.82rem', fontWeight: 700, minWidth: '45px', textAlign: 'center', color: 'var(--text-primary)' }}>
                    {Math.round(currentScale * 100)}%
                  </span>

                  <button
                    onClick={() => setDocZoom((prev) => typeof prev === 'number' ? Math.min(2.0, Number((prev + 0.15).toFixed(2))) : Math.min(2.0, Number((autoScale + 0.15).toFixed(2))))}
                    className="btn-icon"
                    title="Zoom In"
                  >
                    <ZoomIn size={15} />
                  </button>

                  <button
                    onClick={() => setDocZoom('fit')}
                    className={`btn ${docZoom === 'fit' ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem' }}
                    title="Scale document to fit device screen"
                  >
                    <Maximize2 size={13} /> Fit Screen
                  </button>

                  <button
                    onClick={() => setDocZoom(1.0)}
                    className={`btn ${docZoom === 1.0 ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem' }}
                    title="100% Full Print Size"
                  >
                    100%
                  </button>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  <span>{orientation === 'portrait' ? 'A4 Portrait' : 'A4 Landscape'}</span>
                  {currentScale < 0.98 && (
                    <span className="badge badge-emerald">
                      Auto-Fitted to Screen
                    </span>
                  )}
                </div>
              </div>

              {/* Rendered Document Preview Sheet with Adaptive Scaling */}
              <div
                ref={containerRef}
                className="workspace-canvas-wrapper"
                style={{
                  padding: '1.5rem 0.5rem',
                  overflowX: 'auto',
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'flex-start',
                }}
              >
                <div
                  style={{
                    width: `${Math.round(baseDocWidth * currentScale)}px`,
                    height: `${Math.round(previewHeight * currentScale)}px`,
                    position: 'relative',
                    transition: 'width 0.2s ease, height 0.2s ease',
                    flexShrink: 0,
                  }}
                >
                  <div
                    ref={previewRef}
                    style={{
                      width: `${baseDocWidth}px`,
                      transform: `scale(${currentScale})`,
                      transformOrigin: 'top left',
                      minHeight: '1000px',
                      background: '#ffffff',
                      color: '#0f172a',
                      padding: '50px 60px',
                      boxShadow: 'var(--shadow-lg)',
                      borderRadius: '4px',
                      fontFamily: 'system-ui, -apple-system, sans-serif',
                      lineHeight: '1.6',
                      position: 'absolute',
                      top: 0,
                      left: 0,
                    }}
                    dangerouslySetInnerHTML={{
                      __html: `
                      <style>
                        .docx-content h1 { font-size: 26px; color: #0f172a; margin-top: 24px; margin-bottom: 12px; font-weight: 800; border-bottom: 2px solid #e2e8f0; padding-bottom: 6px; }
                        .docx-content h2 { font-size: 20px; color: #1e293b; margin-top: 18px; margin-bottom: 10px; font-weight: 700; }
                        .docx-content p { font-size: 14.5px; color: #334155; margin-bottom: 14px; word-break: break-word; overflow-wrap: break-word; }
                        .docx-content table { width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px; }
                        .docx-content th, .docx-content td { border: 1px solid #cbd5e1; padding: 10px 14px; text-align: left; }
                        .docx-content th { background-color: #f1f5f9; font-weight: 700; color: #0f172a; }
                        .docx-content ul, .docx-content ol { padding-left: 24px; margin-bottom: 14px; color: #334155; }
                        .docx-content li { margin-bottom: 6px; word-break: break-word; }
                        .docx-content pre, .docx-content code { white-space: pre-wrap; word-break: break-word; overflow-wrap: break-word; font-family: 'JetBrains Mono', monospace; font-size: 13px; background: #f8fafc; padding: 2px 5px; border-radius: 4px; }
                      </style>
                      <div class="docx-content">${wordHtml}</div>
                    `,
                    }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 2. PDF TO WORD TAB */}
      {activeMode === 'pdfToWord' && (
        <div>
          {/* Header & Quick Sample */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
                PDF to Microsoft Word Converter
              </h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '0.2rem' }}>
                Extract paragraphs, headings, and formatting into an editable Microsoft Word document.
              </p>
            </div>
            <button
              onClick={handleLoadSamplePdf}
              disabled={isExtractingPdf}
              className="btn btn-secondary"
            >
              <FileText size={15} />
              Try Sample PDF
            </button>
          </div>

          {!extractedResult ? (
            /* Upload Dropzone */
            <div
              className="dropzone glass-panel"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (e.dataTransfer.files[0]) handlePdfUpload(e.dataTransfer.files[0]);
              }}
              onClick={() => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = 'application/pdf';
                input.onchange = (e) => {
                  const target = e.target as HTMLInputElement;
                  if (target.files?.[0]) handlePdfUpload(target.files[0]);
                };
                input.click();
              }}
            >
              <div className="dropzone-icon-ring" style={{ color: '#06b6d4', borderColor: 'rgba(6, 182, 212, 0.3)' }}>
                <FileType size={30} />
              </div>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 700 }}>Choose a PDF document or drop it here</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                Extracts headings, structured paragraphs, tables, and creates formatted .docx file
              </p>
              <span className="btn btn-primary" style={{ marginTop: '0.5rem' }}>
                Browse Files
              </span>

              {isExtractingPdf && (
                <div style={{ width: '80%', maxWidth: '400px', marginTop: '1.5rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>
                    <span>{extractionStatus}</span>
                    <span>{extractionProgress}%</span>
                  </div>
                  <div style={{ height: '8px', background: 'var(--bg-secondary)', borderRadius: '9999px', overflow: 'hidden' }}>
                    <div
                      style={{
                        height: '100%',
                        width: `${extractionProgress}%`,
                        background: 'var(--grad-cyan)',
                        transition: 'width 0.3s ease',
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Extraction Results & Download */
            <div>
              {/* Summary Bar */}
              <div
                className="glass-panel"
                style={{
                  padding: '1.2rem 1.6rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '1.5rem',
                  flexWrap: 'wrap',
                  gap: '1rem',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.3rem' }}>
                    <h3 style={{ fontSize: '1.15rem', fontWeight: 700 }}>{pdfFile?.name || 'document.pdf'}</h3>
                    <span className="badge badge-emerald">
                      <CheckCircle2 size={13} /> Converted to .docx
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '1rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    <span>Pages: <strong>{extractedResult.pages.length}</strong></span>
                    <span>Words: <strong>{extractedResult.totalWords.toLocaleString()}</strong></span>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <button
                    onClick={() => {
                      const allText = extractedResult.pages.map((p) => p.fullText).join('\n\n--- Page Break ---\n\n');
                      navigator.clipboard.writeText(allText);
                      alert('Extracted text copied to clipboard!');
                    }}
                    className="btn btn-secondary"
                  >
                    <Copy size={16} /> Copy Text
                  </button>

                  <button
                    onClick={() => {
                      setPdfFile(null);
                      setExtractedResult(null);
                    }}
                    className="btn btn-secondary"
                  >
                    <RefreshCw size={16} /> Convert Another
                  </button>

                  <a
                    href={URL.createObjectURL(extractedResult.docxBlob)}
                    download={`${pdfFile?.name.replace(/\.pdf$/i, '') || 'Converted_Document'}.docx`}
                    className="btn btn-emerald"
                  >
                    <Download size={16} /> Download Word (.docx)
                  </a>
                </div>
              </div>

              {/* Extracted Content Viewer */}
              <div style={{ display: 'grid', gap: '1.5rem' }}>
                {extractedResult.pages.map((p) => (
                  <div
                    key={p.pageNumber}
                    className="glass-panel"
                    style={{ padding: '1.5rem', background: 'var(--bg-secondary)' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.6rem' }}>
                      <span className="badge badge-blue">Page {p.pageNumber}</span>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        {p.paragraphs.length} paragraphs extracted
                      </span>
                    </div>

                    {p.headings.length > 0 && (
                      <div style={{ marginBottom: '1rem' }}>
                        <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: '#818cf8', fontWeight: 700, letterSpacing: '0.05em' }}>
                          Detected Headings:
                        </span>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.4rem' }}>
                          {p.headings.map((h, i) => (
                            <span
                              key={i}
                              style={{
                                background: 'rgba(99, 102, 241, 0.1)',
                                border: '1px solid rgba(99, 102, 241, 0.25)',
                                color: '#a5b4fc',
                                padding: '3px 8px',
                                borderRadius: 'var(--radius-sm)',
                                fontSize: '0.85rem',
                              }}
                            >
                              {h}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    <div style={{ maxHeight: '300px', overflowY: 'auto', paddingRight: '0.5rem' }}>
                      {p.paragraphs.map((para, i) => (
                        <p key={i} style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '0.8rem', lineHeight: '1.6' }}>
                          {para}
                        </p>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

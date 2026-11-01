import React, { useState } from 'react';
import { 
  Layers, 
  Trash2, 
  ArrowUp, 
  ArrowDown, 
  Download, 
  CheckCircle2, 
  FileText, 
  Image as ImageIcon, 
  FileCode
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { mergeDocuments } from '../../utils/mergeDocuments';
import type { MergeDocumentItem } from '../../utils/mergeDocuments';
import { createSamplePdf } from '../../utils/pdfToWord';
import { createSampleDocx } from '../../utils/wordToPdf';
import { createSampleReceiptImage } from '../../utils/tesseractOcr';

export const DocumentMerger: React.FC = () => {
  const [items, setItems] = useState<MergeDocumentItem[]>([]);
  const [outputFileName, setOutputFileName] = useState('Merged_Master_Document.pdf');
  const [addPageNumbers, setAddPageNumbers] = useState(true);
  const [addCoverPage, setAddCoverPage] = useState(true);
  const [coverTitle, setCoverTitle] = useState('Executive Document Dossier');

  const [isMerging, setIsMerging] = useState(false);
  const [mergeProgress, setMergeProgress] = useState(0);
  const [mergeStatus, setMergeStatus] = useState('');
  const [mergedPdfBlob, setMergedPdfBlob] = useState<Blob | null>(null);

  // Add files to list
  const handleAddFiles = (files: FileList | File[]) => {
    const newItems: MergeDocumentItem[] = Array.from(files).map((file) => ({
      id: `doc-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      file,
      name: file.name,
      size: file.size,
      type: file.type || 'application/octet-stream',
    }));

    setItems((prev) => [...prev, ...newItems]);
    setMergedPdfBlob(null);
  };

  // Reorder items
  const moveItem = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= items.length) return;

    const updated = [...items];
    const [moved] = updated.splice(index, 1);
    updated.splice(targetIndex, 0, moved);
    setItems(updated);
    setMergedPdfBlob(null);
  };

  // Remove item
  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
    setMergedPdfBlob(null);
  };

  // Pre-load 3 diverse sample documents for immediate testing
  const handleLoadSampleDocuments = async () => {
    setIsMerging(true);
    setMergeStatus('Creating sample documents...');
    try {
      // 1. PDF document
      const samplePdfBlob = await createSamplePdf();
      const samplePdfFile = new File([samplePdfBlob], '1_Project_Roadmap.pdf', { type: 'application/pdf' });

      // 2. Word document
      const sampleDocxBlob = await createSampleDocx();
      const sampleDocxFile = new File([sampleDocxBlob], '2_Financial_Summary.docx', {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });

      // 3. Receipt Image
      const receiptDataUrl = createSampleReceiptImage();
      const receiptBlob = await (await fetch(receiptDataUrl)).blob();
      const sampleImgFile = new File([receiptBlob], '3_Hardware_Invoice.png', { type: 'image/png' });

      handleAddFiles([samplePdfFile, sampleDocxFile, sampleImgFile]);
    } finally {
      setIsMerging(false);
      setMergeStatus('');
    }
  };

  // Trigger document merge
  const handleMerge = async () => {
    if (items.length === 0) return;
    setIsMerging(true);
    setMergedPdfBlob(null);
    try {
      const mergedBlob = await mergeDocuments(
        items,
        {
          outputFileName,
          addPageNumbers,
          addCoverPage,
          coverTitle,
          coverSubtitle: `Consolidated Master Document | ${items.length} Files Merged`,
        },
        (prog, stat) => {
          setMergeProgress(prog);
          setMergeStatus(stat);
        }
      );

      setMergedPdfBlob(mergedBlob);
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
      });
    } catch (err) {
      console.error('Merge error:', err);
      alert('Error merging documents. Please check the files and try again.');
    } finally {
      setIsMerging(false);
    }
  };

  // Format file size
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '2rem 1.5rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
            Document Merger
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '0.2rem' }}>
            Combine PDF files, Microsoft Word documents, and images into a single master PDF.
          </p>
        </div>

        <button
          onClick={handleLoadSampleDocuments}
          disabled={isMerging}
          className="btn btn-secondary"
        >
          <Layers size={15} />
          Load 3 Sample Files
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: items.length > 0 ? '1fr 340px' : '1fr', gap: '2rem' }}>
        {/* Left Column: Dropzone & File List */}
        <div>
          {/* File Upload Dropzone */}
          <div
            className="dropzone glass-panel"
            style={{ padding: items.length > 0 ? '1.5rem' : '3rem 2rem', marginBottom: '1.5rem' }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (e.dataTransfer.files.length > 0) handleAddFiles(e.dataTransfer.files);
            }}
            onClick={() => {
              const input = document.createElement('input');
              input.type = 'file';
              input.multiple = true;
              input.accept = '.pdf,.docx,.doc,image/*';
              input.onchange = (e) => {
                const target = e.target as HTMLInputElement;
                if (target.files && target.files.length > 0) handleAddFiles(target.files);
              };
              input.click();
            }}
          >
            <div className="dropzone-icon-ring">
              <Layers size={22} />
            </div>
            <div>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                {items.length > 0 ? 'Drop more files here or click to browse' : 'Choose multiple files to merge'}
              </h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                Accepts PDF, DOCX, PNG, JPG, and WEBP formats
              </p>
            </div>
          </div>

          {/* Document Queue List */}
          {items.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 0.5rem' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Document Queue ({items.length} files)
                </span>
                <button
                  onClick={() => setItems([])}
                  className="btn btn-secondary"
                  style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
                >
                  Clear All
                </button>
              </div>

              {items.map((item, index) => {
                const isPdf = item.name.toLowerCase().endsWith('.pdf');
                const isDocx = item.name.toLowerCase().endsWith('.docx') || item.name.toLowerCase().endsWith('.doc');

                return (
                  <div
                    key={item.id}
                    className="glass-panel"
                    style={{
                      padding: '0.85rem 1.2rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      transition: 'all 0.2s',
                    }}
                  >
                    {/* Item info */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', minWidth: 0, flex: 1 }}>
                      <span
                        style={{
                          width: '26px',
                          height: '26px',
                          borderRadius: '50%',
                          background: 'rgba(255,255,255,0.06)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '0.8rem',
                          fontWeight: 700,
                          color: 'var(--text-secondary)',
                        }}
                      >
                        {index + 1}
                      </span>

                      <div
                        style={{
                          width: '36px',
                          height: '36px',
                          borderRadius: 'var(--radius-md)',
                          background: isPdf
                            ? 'rgba(244, 63, 94, 0.15)'
                            : isDocx
                            ? 'rgba(59, 130, 246, 0.15)'
                            : 'rgba(16, 185, 129, 0.15)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: isPdf ? '#f43f5e' : isDocx ? '#3b82f6' : '#10b981',
                        }}
                      >
                        {isPdf ? <FileText size={18} /> : isDocx ? <FileCode size={18} /> : <ImageIcon size={18} />}
                      </div>

                      <div style={{ minWidth: 0, flex: 1 }}>
                        <p
                          style={{
                            fontWeight: 600,
                            fontSize: '0.9rem',
                            color: 'var(--text-primary)',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {item.name}
                        </p>
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          {formatBytes(item.size)} • {isPdf ? 'PDF Document' : isDocx ? 'Word Document' : 'Image'}
                        </p>
                      </div>
                    </div>

                    {/* Controls */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <button
                        onClick={() => moveItem(index, 'up')}
                        disabled={index === 0}
                        className="btn-icon"
                        title="Move Up"
                        style={{ opacity: index === 0 ? 0.3 : 1 }}
                      >
                        <ArrowUp size={15} />
                      </button>
                      <button
                        onClick={() => moveItem(index, 'down')}
                        disabled={index === items.length - 1}
                        className="btn-icon"
                        title="Move Down"
                        style={{ opacity: index === items.length - 1 ? 0.3 : 1 }}
                      >
                        <ArrowDown size={15} />
                      </button>
                      <button
                        onClick={() => removeItem(item.id)}
                        className="btn-icon"
                        title="Remove file"
                        style={{ color: '#fb7185' }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Column: Merge Settings & Action Panel */}
        {items.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div className="glass-panel" style={{ padding: '1.5rem' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '1.2rem', color: 'var(--text-primary)' }}>
                Merge Settings
              </h3>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>
                    Output File Name
                  </label>
                  <input
                    type="text"
                    value={outputFileName}
                    onChange={(e) => setOutputFileName(e.target.value)}
                    className="input-text"
                    style={{ width: '100%' }}
                  />
                </div>

                <div style={{ paddingTop: '0.5rem', borderTop: '1px solid var(--border-subtle)' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer', fontSize: '0.875rem' }}>
                    <input
                      type="checkbox"
                      checked={addPageNumbers}
                      onChange={(e) => setAddPageNumbers(e.target.checked)}
                      style={{ accentColor: '#6366f1', width: '16px', height: '16px' }}
                    />
                    <span>Add Unified Page Numbers (Footer)</span>
                  </label>
                </div>

                <div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer', fontSize: '0.875rem' }}>
                    <input
                      type="checkbox"
                      checked={addCoverPage}
                      onChange={(e) => setAddCoverPage(e.target.checked)}
                      style={{ accentColor: '#6366f1', width: '16px', height: '16px' }}
                    />
                    <span>Generate Table of Contents & Cover Page</span>
                  </label>
                </div>

                {addCoverPage && (
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>
                      Cover Title
                    </label>
                    <input
                      type="text"
                      value={coverTitle}
                      onChange={(e) => setCoverTitle(e.target.value)}
                      className="input-text"
                      style={{ width: '100%' }}
                    />
                  </div>
                )}

                {/* Progress bar */}
                {isMerging && (
                  <div style={{ marginTop: '0.5rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '0.3rem', color: 'var(--text-secondary)' }}>
                      <span>{mergeStatus}</span>
                      <span>{mergeProgress}%</span>
                    </div>
                    <div style={{ height: '6px', background: 'var(--bg-secondary)', borderRadius: '9999px', overflow: 'hidden' }}>
                      <div
                        style={{
                          height: '100%',
                          width: `${mergeProgress}%`,
                          background: 'var(--grad-primary)',
                          transition: 'width 0.25s ease',
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* Merge Action Button */}
                <button
                  onClick={handleMerge}
                  disabled={isMerging}
                  className="btn btn-primary"
                  style={{ width: '100%', marginTop: '0.5rem', padding: '0.8rem' }}
                >
                  {isMerging ? (
                    <>
                      <div className="spinner" /> Merging Files...
                    </>
                  ) : (
                    <>
                      <Layers size={18} /> Merge {items.length} Documents
                    </>
                  )}
                </button>

                {/* Download Button if Ready */}
                {mergedPdfBlob && (
                  <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <div className="badge badge-emerald" style={{ justifyContent: 'center', padding: '0.5rem' }}>
                      <CheckCircle2 size={15} /> Ready to Download ({(mergedPdfBlob.size / 1024).toFixed(1)} KB)
                    </div>
                    <a
                      href={URL.createObjectURL(mergedPdfBlob)}
                      download={outputFileName.endsWith('.pdf') ? outputFileName : `${outputFileName}.pdf`}
                      className="btn btn-emerald"
                      style={{ width: '100%', padding: '0.8rem' }}
                    >
                      <Download size={18} /> Download Merged PDF
                    </a>
                  </div>
                )}
              </div>
            </div>

            {/* Quick summary card */}
            <div className="glass-panel" style={{ padding: '1.2rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                <span>Total Files:</span>
                <strong style={{ color: 'var(--text-primary)' }}>{items.length}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Total Input Size:</span>
                <strong style={{ color: 'var(--text-primary)' }}>
                  {formatBytes(items.reduce((acc, curr) => acc + curr.size, 0))}
                </strong>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

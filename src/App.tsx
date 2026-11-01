import React, { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar';
import type { ActiveTab } from './components/Navbar';
import { WordPdfConverter } from './components/WordPdfConverter/WordPdfConverter';
import { DocumentMerger } from './components/DocumentMerger/DocumentMerger';
import { PdfEditor } from './components/PdfEditor/PdfEditor';
import { ImageTextEditor } from './components/ImageTextEditor/ImageTextEditor';
import { Cpu, Globe2, ShieldCheck } from 'lucide-react';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('pdfEditor');
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('docucraft_theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return 'light'; // Default to pristine white mode
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('docucraft_theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  return (
    <div className="app-container">
      {/* Navigation Bar with Theme Switcher */}
      <Navbar 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        theme={theme}
        toggleTheme={toggleTheme}
      />

      {/* Main Content Area */}
      <main style={{ flex: 1, paddingBottom: '3.5rem' }}>
        {activeTab === 'converter' && <WordPdfConverter />}
        {activeTab === 'merger' && <DocumentMerger />}
        {activeTab === 'pdfEditor' && <PdfEditor />}
        {activeTab === 'imageEditor' && <ImageTextEditor />}
      </main>

      {/* Global Tech & Privacy Footer */}
      <footer
        style={{
          borderTop: '1px solid var(--border-subtle)',
          background: 'var(--bg-footer)',
          padding: '1.75rem 1.5rem',
          transition: 'background-color 0.25s ease, border-color 0.25s ease',
        }}
      >
        <div className="footer-content">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.25rem' }}>
              <span style={{ fontWeight: 700, fontSize: '0.92rem', color: 'var(--text-primary)' }}>
                DocuCraft
              </span>
              <span className="badge badge-subtle">Private Workspace</span>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
              Client-side document engine. Your documents and credentials never leave your browser.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <ShieldCheck size={14} color="var(--accent-emerald)" />
              <span>In-Memory Only</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <Cpu size={14} color="var(--primary)" />
              <span>WebAssembly PDF & OCR</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <Globe2 size={14} color="var(--text-muted)" />
              <span>Offline Ready</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;

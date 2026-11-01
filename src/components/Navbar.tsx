import React from 'react';
import { 
  FileText, 
  Layers, 
  Edit3, 
  Scan, 
  FileCode2,
  Sun,
  Moon
} from 'lucide-react';

export type ActiveTab = 'converter' | 'merger' | 'pdfEditor' | 'imageEditor';

interface NavbarProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ 
  activeTab, 
  setActiveTab, 
  theme, 
  toggleTheme 
}) => {
  return (
    <header className="navbar">
      <div className="navbar-top-row">
        {/* Brand */}
        <div className="logo-group" onClick={() => setActiveTab('pdfEditor')}>
          <div className="logo-badge">
            <FileCode2 size={19} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <span className="logo-text">DocuCraft</span>
              <span className="logo-tag">Studio</span>
            </div>
            <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', letterSpacing: '0.01em' }}>
              Private Document Workspace
            </p>
          </div>
        </div>

        {/* Right Controls: Privacy Indicator & Theme Toggle */}
        <div className="navbar-actions">
          {/* Subtle Local Privacy Status */}
          <div
            className="privacy-badge-pill"
            title="All files are processed entirely in browser memory. Zero cloud telemetry."
          >
            <span 
              style={{ 
                width: '6px', 
                height: '6px', 
                borderRadius: '50%', 
                background: 'var(--accent-emerald)',
                boxShadow: '0 0 6px var(--accent-emerald)',
                flexShrink: 0
              }} 
            />
            <span className="privacy-pill-text">100% Private</span>
          </div>

          {/* Theme Toggle Button */}
          <button
            onClick={toggleTheme}
            className="btn-theme-toggle"
            title={`Switch to ${theme === 'light' ? 'Dark' : 'White'} Mode`}
            aria-label="Toggle visual theme"
          >
            {theme === 'light' ? (
              <>
                <Moon size={14} color="var(--text-secondary)" />
                <span className="theme-toggle-text">Dark</span>
              </>
            ) : (
              <>
                <Sun size={14} color="var(--accent-amber)" />
                <span className="theme-toggle-text">White</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Segmented Navigation Tabs */}
      <nav className="nav-tabs">
        <button
          className={`nav-tab-btn ${activeTab === 'pdfEditor' ? 'active' : ''}`}
          onClick={() => setActiveTab('pdfEditor')}
        >
          <Edit3 className="tab-icon" />
          <span>PDF Editor</span>
        </button>

        <button
          className={`nav-tab-btn ${activeTab === 'converter' ? 'active' : ''}`}
          onClick={() => setActiveTab('converter')}
        >
          <FileText className="tab-icon" />
          <span>Convert</span>
        </button>

        <button
          className={`nav-tab-btn ${activeTab === 'merger' ? 'active' : ''}`}
          onClick={() => setActiveTab('merger')}
        >
          <Layers className="tab-icon" />
          <span>Merge</span>
        </button>

        <button
          className={`nav-tab-btn ${activeTab === 'imageEditor' ? 'active' : ''}`}
          onClick={() => setActiveTab('imageEditor')}
        >
          <Scan className="tab-icon" />
          <span>Image OCR</span>
        </button>
      </nav>
    </header>
  );
};

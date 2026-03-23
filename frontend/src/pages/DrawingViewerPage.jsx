import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Document, Page, pdfjs } from 'react-pdf';
import { ArrowLeft, ZoomIn, ZoomOut, ChevronLeft, ChevronRight, Loader2, AlertTriangle } from 'lucide-react';
import { getProjectIssues, getFileUrl } from '../lib/api';
import { useUIStore } from '../stores';
import { severityColor } from '../lib/utils';
import IssuePanel from '../components/IssuePanel';

import 'react-pdf/dist/esm/Page/AnnotationLayer.css';
import 'react-pdf/dist/esm/Page/TextLayer.css';

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

export default function DrawingViewerPage() {
  const { id, fileId } = useParams();
  const navigate = useNavigate();
  const openIssueDrawer = useUIStore((s) => s.openIssueDrawer);

  const [numPages, setNumPages] = useState(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1.2);

  const { data: fileUrlData } = useQuery({
    queryKey: ['file-url', id, fileId],
    queryFn: () => getFileUrl(id, fileId),
  });

  const { data: issues = [] } = useQuery({
    queryKey: ['issues', id],
    queryFn: () => getProjectIssues(id),
  });

  const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';
  const pdfUrl = fileUrlData?.url ? `${API_BASE}${fileUrlData.url}` : null;

  // Filter findings for current page
  const pageIssues = issues.filter((i) => {
    const ref = i.drawing_ref || '';
    return ref.includes(`Page ${pageNumber}`) || ref.includes(`page ${pageNumber}`);
  });

  return (
    <div className="space-y-4 animate-fade-in">
      <IssuePanel projectId={id} />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(`/project/${id}`)} className="btn-ghost p-2">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h2 className="text-xl font-bold text-white">Drawing Viewer</h2>
        </div>

        <div className="flex items-center gap-2">
          <button className="btn-ghost p-2" onClick={() => setScale((s) => Math.max(0.5, s - 0.2))}>
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-sm text-surface-400 w-16 text-center">{Math.round(scale * 100)}%</span>
          <button className="btn-ghost p-2" onClick={() => setScale((s) => Math.min(3, s + 0.2))}>
            <ZoomIn className="w-4 h-4" />
          </button>
          <div className="mx-2 h-5 w-px bg-surface-700" />
          <button
            className="btn-ghost p-2"
            disabled={pageNumber <= 1}
            onClick={() => setPageNumber((p) => p - 1)}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm text-surface-300 min-w-[80px] text-center">
            {pageNumber} / {numPages || '—'}
          </span>
          <button
            className="btn-ghost p-2"
            disabled={pageNumber >= (numPages || 1)}
            onClick={() => setPageNumber((p) => p + 1)}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* PDF Viewer */}
        <div className="lg:col-span-3 glass-card p-4 overflow-auto flex justify-center" style={{ maxHeight: 'calc(100vh - 200px)' }}>
          {pdfUrl ? (
            <Document
              file={pdfUrl}
              onLoadSuccess={({ numPages: n }) => setNumPages(n)}
              loading={
                <div className="flex items-center justify-center py-32">
                  <Loader2 className="w-8 h-8 text-brand-400 animate-spin" />
                </div>
              }
              error={
                <div className="flex flex-col items-center justify-center py-32 text-surface-400">
                  <AlertTriangle className="w-8 h-8 mb-2" />
                  <p>Failed to load PDF</p>
                </div>
              }
            >
              <Page pageNumber={pageNumber} scale={scale} />
            </Document>
          ) : (
            <div className="flex items-center justify-center py-32">
              <Loader2 className="w-8 h-8 text-brand-400 animate-spin" />
            </div>
          )}
        </div>

        {/* Page Findings Sidebar */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-surface-300 uppercase tracking-wider">
            Findings on Page {pageNumber}
          </h3>
          {pageIssues.length === 0 ? (
            <p className="text-surface-500 text-sm">No findings for this page.</p>
          ) : (
            pageIssues.map((issue) => (
              <div
                key={issue.id}
                className="glass-card-hover p-3 cursor-pointer"
                onClick={() => openIssueDrawer(issue)}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className={severityColor(issue.severity)}>{issue.severity}</span>
                </div>
                <p className="text-white text-sm font-medium">{issue.issue_type}</p>
                <p className="text-surface-400 text-xs mt-0.5 line-clamp-2">{issue.description}</p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

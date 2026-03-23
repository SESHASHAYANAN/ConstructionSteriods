import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  X, CheckCircle, Loader2, Wrench, History, Activity,
  AlertTriangle, Image as ImageIcon, ChevronDown, ChevronUp,
  Sparkles, Shield, FileText, Eye, ZoomIn
} from 'lucide-react';
import {
  applyIssueFix, getIssueVersions, getProjectDrawingImage
} from '../lib/api';
import { useUIStore } from '../stores';
import { severityColor, statusColor } from '../lib/utils';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/esm/Page/AnnotationLayer.css';
import 'react-pdf/dist/esm/Page/TextLayer.css';

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

/** Display a field value, falling back to "N/A" */
function FieldValue({ value, className = 'text-surface-200 text-sm' }) {
  const display = value && value.trim() ? value : 'N/A';
  return <p className={`${className} ${!value || !value.trim() ? 'text-surface-500 italic' : ''}`}>{display}</p>;
}

/** Draw annotation circles on a canvas overlay */
function drawAnnotations(ctx, width, height, issue, isFixed) {
  // Generate consistent annotation position from issue data
  let hash = 0;
  const str = (issue?.description || '') + (issue?.id || '');
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  const px = 0.25 + (Math.abs(hash % 50) / 100);
  const py = 0.25 + (Math.abs((hash >> 8) % 50) / 100);
  const cx = px * width;
  const cy = py * height;
  const radius = Math.min(width, height) * 0.06;

  if (isFixed) {
    ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 3; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, radius + 5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(34, 197, 94, 0.25)'; ctx.lineWidth = 8; ctx.stroke();
    ctx.fillStyle = '#22c55e';
    ctx.font = `bold ${Math.max(14, radius * 0.6)}px Calibri, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('✓', cx, cy + radius * 0.2);
    ctx.font = `bold ${Math.max(11, radius * 0.4)}px Calibri, sans-serif`;
    ctx.fillText('RESOLVED', cx, cy - radius - 10);
  } else {
    ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 3; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, radius + 5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.25)'; ctx.lineWidth = 8; ctx.stroke();
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.5)'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx - radius * 0.5, cy); ctx.lineTo(cx + radius * 0.5, cy);
    ctx.moveTo(cx, cy - radius * 0.5); ctx.lineTo(cx, cy + radius * 0.5);
    ctx.stroke();
    ctx.fillStyle = '#ef4444';
    ctx.font = `bold ${Math.max(11, radius * 0.4)}px Calibri, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('ISSUE', cx, cy - radius - 10);
  }
}

/** Drawing image with error circle annotation — supports both PDF and image files */
function DrawingAnnotationView({ projectId, issue, isFixed }) {
  const canvasRef = useRef(null);
  const imageRef = useRef(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [pdfReady, setPdfReady] = useState(false);
  const [showZoom, setShowZoom] = useState(false);

  // Fetch drawing image info from project
  const { data: drawingData } = useQuery({
    queryKey: ['drawing-image', projectId],
    queryFn: () => getProjectDrawingImage(projectId),
    enabled: !!projectId,
    retry: false,
  });

  const fileUrl = drawingData?.url ? `${API_BASE}${drawingData.url}` : null;
  const isPdf = drawingData?.type === 'pdf';

  // Callback when react-pdf finishes rendering a page
  const onPdfRenderSuccess = useCallback(() => {
    setPdfReady(true);
  }, []);

  // Draw annotations on the overlay canvas whenever PDF or image is ready
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (isPdf && pdfReady) {
      // Find the rendered react-pdf canvas in the DOM
      const container = canvas.parentElement;
      const pdfCanvas = container?.querySelector('.react-pdf__Page__canvas');
      if (!pdfCanvas) return;
      canvas.width = pdfCanvas.width;
      canvas.height = pdfCanvas.height;
      canvas.style.width = pdfCanvas.style.width;
      canvas.style.height = pdfCanvas.style.height;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawAnnotations(ctx, canvas.width, canvas.height, issue, isFixed);
    } else if (!isPdf && imageLoaded) {
      const img = imageRef.current;
      if (!img) return;
      canvas.width = img.naturalWidth || 800;
      canvas.height = img.naturalHeight || 600;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      drawAnnotations(ctx, canvas.width, canvas.height, issue, isFixed);
    }
  }, [imageLoaded, pdfReady, isPdf, isFixed, issue?.id]);

  if (!fileUrl) {
    return (
      <div className="p-6 text-center">
        <ImageIcon className="w-8 h-8 text-surface-600 mx-auto mb-2" />
        <p className="text-surface-500 text-sm">No drawing image available for this project</p>
      </div>
    );
  }

  return (
    <div className="relative">
      {isPdf ? (
        /* ── PDF Rendering via react-pdf ── */
        <div className="relative cursor-pointer" onClick={() => setShowZoom(!showZoom)}>
          <Document
            file={fileUrl}
            loading={
              <div className="p-8 text-center">
                <Loader2 className="w-6 h-6 text-surface-400 mx-auto animate-spin" />
                <p className="text-surface-500 text-xs mt-2">Loading drawing...</p>
              </div>
            }
            error={
              <div className="p-6 text-center">
                <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto mb-2" />
                <p className="text-surface-400 text-sm">Failed to load PDF drawing</p>
              </div>
            }
          >
            <Page
              pageNumber={1}
              width={600}
              onRenderSuccess={onPdfRenderSuccess}
              renderTextLayer={false}
              renderAnnotationLayer={false}
            />
          </Document>
          {/* Annotation overlay canvas on top of PDF */}
          {pdfReady && (
            <canvas
              ref={canvasRef}
              className="absolute top-0 left-0 pointer-events-none"
              style={{ zIndex: 10 }}
            />
          )}
          {pdfReady && (
            <div className="flex items-center justify-between mt-2">
              <div className="flex items-center gap-2">
                {isFixed ? (
                  <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
                    <CheckCircle className="w-3.5 h-3.5" /> Issue resolved — circle updated
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs text-red-400 animate-pulse">
                    <AlertTriangle className="w-3.5 h-3.5" /> Error highlighted with circle
                  </span>
                )}
              </div>
              <button className="btn-ghost text-xs" onClick={(e) => { e.stopPropagation(); setShowZoom(!showZoom); }}>
                <ZoomIn className="w-3.5 h-3.5" />
                {showZoom ? 'Collapse' : 'Expand'}
              </button>
            </div>
          )}
        </div>
      ) : (
        /* ── Image Rendering (non-PDF) ── */
        <>
          <img
            ref={imageRef}
            src={fileUrl}
            alt="Drawing"
            className="hidden"
            crossOrigin="anonymous"
            onLoad={() => setImageLoaded(true)}
            onError={() => setImageLoaded(false)}
          />
          {!imageLoaded ? (
            <div className="p-8 text-center">
              <Loader2 className="w-6 h-6 text-surface-400 mx-auto animate-spin" />
              <p className="text-surface-500 text-xs mt-2">Loading drawing...</p>
            </div>
          ) : (
            <>
              <canvas
                ref={canvasRef}
                className="w-full rounded-xl border border-surface-700 cursor-pointer"
                style={{ maxHeight: '300px', objectFit: 'contain' }}
                onClick={() => setShowZoom(!showZoom)}
              />
              <div className="flex items-center justify-between mt-2">
                <div className="flex items-center gap-2">
                  {isFixed ? (
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
                      <CheckCircle className="w-3.5 h-3.5" /> Issue resolved — circle updated
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-red-400 animate-pulse">
                      <AlertTriangle className="w-3.5 h-3.5" /> Error highlighted with circle
                    </span>
                  )}
                </div>
                <button className="btn-ghost text-xs" onClick={() => setShowZoom(!showZoom)}>
                  <ZoomIn className="w-3.5 h-3.5" />
                  {showZoom ? 'Collapse' : 'Expand'}
                </button>
              </div>
            </>
          )}
        </>
      )}

      {/* Expanded zoom overlay */}
      {showZoom && (pdfReady || imageLoaded) && (
        <div className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-8" onClick={() => setShowZoom(false)}>
          <div className="relative max-w-5xl max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            {isPdf ? (
              <div className="relative">
                <Document file={fileUrl}>
                  <Page
                    pageNumber={1}
                    width={1200}
                    renderTextLayer={false}
                    renderAnnotationLayer={false}
                    onRenderSuccess={() => {
                      // Draw annotations on zoom overlay
                      const zoomOverlay = document.getElementById(`zoom-annotation-${issue?.id}-${isFixed}`);
                      if (!zoomOverlay) return;
                      const pdfC = zoomOverlay.parentElement?.querySelector('.react-pdf__Page__canvas');
                      if (!pdfC) return;
                      zoomOverlay.width = pdfC.width;
                      zoomOverlay.height = pdfC.height;
                      zoomOverlay.style.width = pdfC.style.width;
                      zoomOverlay.style.height = pdfC.style.height;
                      const ctx = zoomOverlay.getContext('2d');
                      ctx.clearRect(0, 0, zoomOverlay.width, zoomOverlay.height);
                      drawAnnotations(ctx, zoomOverlay.width, zoomOverlay.height, issue, isFixed);
                    }}
                  />
                </Document>
                <canvas
                  id={`zoom-annotation-${issue?.id}-${isFixed}`}
                  className="absolute top-0 left-0 pointer-events-none"
                  style={{ zIndex: 10 }}
                />
              </div>
            ) : (
              <canvas
                ref={(el) => {
                  if (!el) return;
                  const img = imageRef.current;
                  if (!img) return;
                  const ctx = el.getContext('2d');
                  el.width = img.naturalWidth || 800;
                  el.height = img.naturalHeight || 600;
                  ctx.drawImage(img, 0, 0, el.width, el.height);
                  drawAnnotations(ctx, el.width, el.height, issue, isFixed);
                }}
                className="rounded-xl border border-surface-700"
              />
            )}
            <button
              className="absolute top-2 right-2 p-2 rounded-full bg-surface-900/80 text-white hover:bg-surface-800"
              onClick={() => setShowZoom(false)}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function IssueDetailModal({ projectId }) {
  const queryClient = useQueryClient();
  const { issueModalOpen, selectedModalIssue, modalContext, closeIssueModal } = useUIStore();

  const [showVersions, setShowVersions] = useState(false);
  const [fixApplied, setFixApplied] = useState(false);
  const [fixAnimating, setFixAnimating] = useState(false);
  const [showFixDetail, setShowFixDetail] = useState(false);

  const issue = selectedModalIssue;

  // Fetch version history
  const { data: versions = [] } = useQuery({
    queryKey: ['issue-versions', issue?.id],
    queryFn: () => getIssueVersions(issue.id),
    enabled: !!issue?.id && showVersions,
  });

  // Reset state when modal opens/closes
  useEffect(() => {
    if (issueModalOpen) {
      setFixApplied(false);
      setFixAnimating(false);
      setShowVersions(false);
      setShowFixDetail(false);
    }
  }, [issueModalOpen, issue?.id]);

  // Apply fix mutation
  const fixMutation = useMutation({
    mutationFn: () => applyIssueFix(issue.id),
    onSuccess: () => {
      setFixAnimating(true);
      setTimeout(() => {
        setFixApplied(true);
        setFixAnimating(false);
        queryClient.invalidateQueries({ queryKey: ['issues', projectId] });
        queryClient.invalidateQueries({ queryKey: ['ncrs', projectId] });
        queryClient.invalidateQueries({ queryKey: ['rfis', projectId] });
        queryClient.invalidateQueries({ queryKey: ['issue-versions', issue.id] });
      }, 1200);
    },
  });

  if (!issueModalOpen || !issue) return null;

  const isFixed = issue.status === 'Fixed' || fixApplied;
  const contextLabel = modalContext === 'ncr' ? 'NCR Detail' : modalContext === 'rfi' ? 'RFI Detail' : 'Finding Detail';

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" onClick={closeIssueModal} />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={closeIssueModal}>
        <div
          className="bg-surface-900 border border-surface-700 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto animate-modal-enter"
          onClick={(e) => e.stopPropagation()}
          id="issue-detail-modal"
        >
          {/* Header */}
          <div className="sticky top-0 bg-surface-900/95 backdrop-blur-sm border-b border-surface-800 p-5 flex items-center justify-between rounded-t-2xl z-10">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-brand-500/10">
                <Shield className="w-5 h-5 text-brand-400" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">{contextLabel}</h3>
                <p className="text-xs text-surface-500 font-mono">ID: {issue.id?.slice(0, 8).toUpperCase()}</p>
              </div>
            </div>
            <button onClick={closeIssueModal} className="btn-ghost p-1.5" id="close-issue-modal">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-5 space-y-5">
            {/* Severity & Status */}
            <div className="flex items-center gap-3 flex-wrap">
              <span className={severityColor(issue.severity)}>{issue.severity || 'N/A'}</span>
              <span className={`text-sm font-medium ${isFixed ? 'text-emerald-400' : statusColor(issue.status)}`}>
                {isFixed ? '✓ Fixed' : issue.status || 'N/A'}
              </span>
              <span className="text-xs text-surface-600 bg-surface-800 px-2 py-1 rounded-lg">{issue.agent_source || 'N/A'}</span>
              {isFixed && (
                <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 animate-pulse">
                  <CheckCircle className="w-3 h-3" /> Fix Applied
                </span>
              )}
            </div>

            {/* Issue Type */}
            <div>
              <p className="text-xs text-surface-500 uppercase tracking-wider mb-1">Issue Type</p>
              <FieldValue value={issue.issue_type} className="text-white font-semibold" />
            </div>

            {/* Drawing Ref & Location */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-surface-500 uppercase tracking-wider mb-1">Drawing Ref</p>
                <FieldValue value={issue.drawing_ref} />
              </div>
              <div>
                <p className="text-xs text-surface-500 uppercase tracking-wider mb-1">Location</p>
                <FieldValue value={issue.location} />
              </div>
            </div>

            {/* Description */}
            <div>
              <p className="text-xs text-surface-500 uppercase tracking-wider mb-1">Description</p>
              <div className="p-3 rounded-xl bg-surface-800/50 border border-surface-700/50">
                <FieldValue value={issue.description} className="text-surface-200 text-sm leading-relaxed" />
              </div>
            </div>

            {/* Proposed Solution */}
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                <p className="text-xs text-emerald-400 uppercase tracking-wider font-semibold">Proposed Solution</p>
              </div>
              <div className="p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
                <FieldValue value={issue.suggested_fix} className="text-emerald-300 text-sm leading-relaxed" />
              </div>
            </div>

            {/* Code Clause */}
            <div>
              <p className="text-xs text-surface-500 uppercase tracking-wider mb-1">Code Reference</p>
              <div className="p-3 rounded-xl bg-brand-500/5 border border-brand-500/15">
                <FieldValue value={issue.code_clause} className="text-brand-300 text-sm font-mono" />
              </div>
            </div>

            {/* ── Drawing Image with Annotation ── */}
            <div className="border border-surface-700/50 rounded-xl overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 bg-surface-800/50 border-b border-surface-700/50">
                <ImageIcon className="w-4 h-4 text-surface-400" />
                <span className="text-sm font-medium text-surface-300">
                  {isFixed ? 'Drawing — Issue Resolved' : 'Drawing — Error Highlighted'}
                </span>
              </div>
              <div className="p-4">
                <DrawingAnnotationView
                  projectId={projectId}
                  issue={issue}
                  isFixed={isFixed}
                />
              </div>
            </div>

            {/* ── Auto-Apply Fix Button ── */}
            {!isFixed && (
              <div className="pt-2">
                <button
                  className={`w-full justify-center py-3 rounded-xl font-semibold text-sm transition-all duration-300 inline-flex items-center gap-2 ${
                    fixAnimating
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 scale-[1.02]'
                      : 'bg-gradient-to-r from-emerald-600 to-emerald-500 text-white shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40 hover:scale-[1.02] active:scale-[0.98]'
                  }`}
                  onClick={() => fixMutation.mutate()}
                  disabled={fixMutation.isPending || fixAnimating}
                  id="auto-apply-fix-btn"
                >
                  {fixMutation.isPending ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Applying Fix...</>
                  ) : fixAnimating ? (
                    <><CheckCircle className="w-5 h-5 animate-bounce" /> Fix Applied Successfully!</>
                  ) : (
                    <><Wrench className="w-4 h-4" /> Auto-Apply Fix</>
                  )}
                </button>
              </div>
            )}

            {/* Fix Applied Confirmation */}
            {isFixed && !fixAnimating && (
              <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-3 animate-fade-in">
                <CheckCircle className="w-6 h-6 text-emerald-400 shrink-0" />
                <div>
                  <p className="text-emerald-400 font-semibold text-sm">Fix Applied Successfully</p>
                  <p className="text-emerald-400/70 text-xs mt-0.5">This issue has been marked as fixed. The corrective action has been applied.</p>
                </div>
              </div>
            )}

            {/* ── View Fixed Issue Detail Button ── */}
            {isFixed && !fixAnimating && (
              <div>
                <button
                  className="w-full justify-center py-3 rounded-xl font-semibold text-sm transition-all duration-300 inline-flex items-center gap-2 bg-gradient-to-r from-brand-600 to-brand-500 text-white shadow-lg shadow-brand-500/25 hover:shadow-brand-500/40 hover:scale-[1.02] active:scale-[0.98]"
                  onClick={() => setShowFixDetail(!showFixDetail)}
                  id="view-fixed-issue-btn"
                >
                  <Eye className="w-4 h-4" />
                  {showFixDetail ? 'Hide Fix Details' : 'View Fixed Issue Details'}
                </button>

                {showFixDetail && (
                  <div className="mt-3 p-4 rounded-xl bg-surface-800/50 border border-surface-700/50 space-y-4 animate-fade-in">
                    <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                      <Shield className="w-4 h-4 text-brand-400" /> Fix Resolution Details
                    </h4>

                    {/* Before state */}
                    <div className="p-3 rounded-lg bg-red-500/5 border border-red-500/20">
                      <p className="text-xs text-red-400 uppercase tracking-wider font-semibold mb-1">Before Fix</p>
                      <p className="text-surface-300 text-sm"><strong>Issue:</strong> {issue.issue_type || 'N/A'}</p>
                      <p className="text-surface-400 text-sm mt-1">{issue.description || 'No description'}</p>
                      <p className="text-red-400/70 text-xs mt-1">Severity: {issue.severity} · Status: Open</p>
                    </div>

                    {/* After state */}
                    <div className="p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
                      <p className="text-xs text-emerald-400 uppercase tracking-wider font-semibold mb-1">After Fix</p>
                      <p className="text-surface-300 text-sm"><strong>Resolution:</strong> {issue.suggested_fix || 'Review and address manually.'}</p>
                      <p className="text-emerald-400/70 text-xs mt-1">Status: Fixed · Corrective action applied</p>
                      {issue.code_clause && (
                        <p className="text-brand-300 text-xs mt-1 font-mono">Code Ref: {issue.code_clause}</p>
                      )}
                    </div>

                    {/* Drawing comparison */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="border border-red-500/20 rounded-lg p-2">
                        <p className="text-xs text-red-400 text-center mb-2 font-medium">Before</p>
                        <DrawingAnnotationView projectId={projectId} issue={issue} isFixed={false} />
                      </div>
                      <div className="border border-emerald-500/20 rounded-lg p-2">
                        <p className="text-xs text-emerald-400 text-center mb-2 font-medium">After</p>
                        <DrawingAnnotationView projectId={projectId} issue={issue} isFixed={true} />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Version History ── */}
            <div className="border border-surface-700/50 rounded-xl overflow-hidden">
              <button
                className="flex items-center justify-between w-full px-4 py-3 bg-surface-800/50 hover:bg-surface-800 transition-colors"
                onClick={() => setShowVersions(!showVersions)}
              >
                <div className="flex items-center gap-2">
                  <History className="w-4 h-4 text-surface-400" />
                  <span className="text-sm font-medium text-surface-300">Version History</span>
                </div>
                {showVersions ? <ChevronUp className="w-4 h-4 text-surface-500" /> : <ChevronDown className="w-4 h-4 text-surface-500" />}
              </button>
              {showVersions && (
                <div className="p-4 space-y-2 border-t border-surface-700/50 max-h-48 overflow-y-auto">
                  {versions.length === 0 ? (
                    <p className="text-surface-500 text-sm text-center py-2">No version history available</p>
                  ) : (
                    versions.map((v, i) => (
                      <div key={i} className="flex items-start gap-3 p-2 rounded-lg bg-surface-800/30">
                        <div className="p-1 rounded-full bg-brand-500/10 mt-0.5">
                          <Activity className="w-3 h-3 text-brand-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono text-surface-500">v{v.version}</span>
                            <span className="text-xs text-surface-600">{v.timestamp?.slice(0, 16).replace('T', ' ')}</span>
                          </div>
                          <p className="text-sm text-surface-300 mt-0.5">
                            <span className="text-surface-400">{v.field_changed}:</span>{' '}
                            <span className="text-red-400 line-through">{v.old_value}</span>{' → '}
                            <span className="text-emerald-400">{v.new_value}</span>
                          </p>
                          {v.user_email && (
                            <p className="text-xs text-surface-600 mt-0.5">by {v.user_email}</p>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

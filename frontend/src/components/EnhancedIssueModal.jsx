/**
 * EnhancedIssueModal — Drop-in replacement for IssueDetailModal.
 * Uses SVG-based ErrorHighlightOverlay instead of canvas drawAnnotations.
 * All other functionality identical to IssueDetailModal.
 */
import React, { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  X, CheckCircle, Loader2, Wrench, History, Activity,
  AlertTriangle, ChevronDown, ChevronUp,
  Sparkles, Shield, Eye, Image as ImageIcon
} from 'lucide-react';
import { applyIssueFix, getIssueVersions } from '../lib/api';
import { useUIStore } from '../stores';
import { severityColor, statusColor } from '../lib/utils';
import ErrorHighlightOverlay from './ErrorHighlightOverlay';

function FieldValue({ value, className = 'text-surface-200 text-sm' }) {
  const display = value && value.trim() ? value : 'N/A';
  return <p className={`${className} ${!value || !value.trim() ? 'text-surface-500 italic' : ''}`}>{display}</p>;
}

export default function EnhancedIssueModal({ projectId }) {
  const queryClient = useQueryClient();
  const { issueModalOpen, selectedModalIssue, modalContext, closeIssueModal } = useUIStore();

  const [showVersions, setShowVersions] = useState(false);
  const [fixApplied, setFixApplied] = useState(false);
  const [fixAnimating, setFixAnimating] = useState(false);
  const [showFixDetail, setShowFixDetail] = useState(false);

  const issue = selectedModalIssue;

  const { data: versions = [] } = useQuery({
    queryKey: ['issue-versions', issue?.id],
    queryFn: () => getIssueVersions(issue.id),
    enabled: !!issue?.id && showVersions,
  });

  useEffect(() => {
    if (issueModalOpen) {
      setFixApplied(false);
      setFixAnimating(false);
      setShowVersions(false);
      setShowFixDetail(false);
    }
  }, [issueModalOpen, issue?.id]);

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
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" onClick={closeIssueModal} />
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

            {/* ── Drawing Image with SVG Annotation ── */}
            <div className="border border-surface-700/50 rounded-xl overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 bg-surface-800/50 border-b border-surface-700/50">
                <ImageIcon className="w-4 h-4 text-surface-400" />
                <span className="text-sm font-medium text-surface-300">
                  {isFixed ? 'Drawing — Issue Resolved' : 'Drawing — Error Highlighted'}
                </span>
              </div>
              <div className="p-4">
                <ErrorHighlightOverlay
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
                    <div className="p-3 rounded-lg bg-red-500/5 border border-red-500/20">
                      <p className="text-xs text-red-400 uppercase tracking-wider font-semibold mb-1">Before Fix</p>
                      <p className="text-surface-300 text-sm"><strong>Issue:</strong> {issue.issue_type || 'N/A'}</p>
                      <p className="text-surface-400 text-sm mt-1">{issue.description || 'No description'}</p>
                      <p className="text-red-400/70 text-xs mt-1">Severity: {issue.severity} · Status: Open</p>
                    </div>
                    <div className="p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
                      <p className="text-xs text-emerald-400 uppercase tracking-wider font-semibold mb-1">After Fix</p>
                      <p className="text-surface-300 text-sm"><strong>Resolution:</strong> {issue.suggested_fix || 'Review and address manually.'}</p>
                      <p className="text-emerald-400/70 text-xs mt-1">Status: Fixed · Corrective action applied</p>
                      {issue.code_clause && (
                        <p className="text-brand-300 text-xs mt-1 font-mono">Code Ref: {issue.code_clause}</p>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="border border-red-500/20 rounded-lg p-2">
                        <p className="text-xs text-red-400 text-center mb-2 font-medium">Before</p>
                        <ErrorHighlightOverlay projectId={projectId} issue={issue} isFixed={false} />
                      </div>
                      <div className="border border-emerald-500/20 rounded-lg p-2">
                        <p className="text-xs text-emerald-400 text-center mb-2 font-medium">After</p>
                        <ErrorHighlightOverlay projectId={projectId} issue={issue} isFixed={true} />
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

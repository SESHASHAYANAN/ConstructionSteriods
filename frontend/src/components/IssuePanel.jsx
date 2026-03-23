import React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X, CheckCircle, XCircle, AlertTriangle, ArrowUpCircle, FileText, MessageSquare, Loader2 } from 'lucide-react';
import { updateIssue, createNCR, createRFI } from '../lib/api';
import { useUIStore } from '../stores';
import { severityColor, statusColor } from '../lib/utils';

/** Display a field value, falling back to "N/A" for empty/null values */
function FieldValue({ value, className = 'text-surface-200 text-sm' }) {
  const display = value && value.trim() ? value : 'N/A';
  return <p className={`${className} ${!value || !value.trim() ? 'text-surface-500 italic' : ''}`}>{display}</p>;
}

export default function IssuePanel({ projectId }) {
  const queryClient = useQueryClient();
  const { issueDrawerOpen, selectedIssue, closeIssueDrawer } = useUIStore();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['issues', projectId] });
    queryClient.invalidateQueries({ queryKey: ['ncrs', projectId] });
    queryClient.invalidateQueries({ queryKey: ['rfis', projectId] });
  };

  const acceptMutation = useMutation({
    mutationFn: () => updateIssue(selectedIssue.id, 'Accepted'),
    onSuccess: () => { invalidate(); closeIssueDrawer(); },
  });

  const rejectMutation = useMutation({
    mutationFn: () => updateIssue(selectedIssue.id, 'Rejected'),
    onSuccess: () => { invalidate(); closeIssueDrawer(); },
  });

  const ncrMutation = useMutation({
    mutationFn: () => createNCR(selectedIssue.id),
    onSuccess: () => { invalidate(); closeIssueDrawer(); },
  });

  const rfiMutation = useMutation({
    mutationFn: () => createRFI(selectedIssue.id),
    onSuccess: () => { invalidate(); closeIssueDrawer(); },
  });

  if (!issueDrawerOpen || !selectedIssue) return null;

  const isOpen = selectedIssue.status === 'Open';
  const isAccepted = selectedIssue.status === 'Accepted';
  const canRaiseNCR = isOpen || isAccepted;
  const canRaiseRFI = isOpen || isAccepted;
  const anyLoading = acceptMutation.isPending || rejectMutation.isPending || ncrMutation.isPending || rfiMutation.isPending;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40" onClick={closeIssueDrawer} />

      {/* Drawer */}
      <div className="fixed right-0 top-0 h-full w-full max-w-lg bg-surface-900 border-l border-surface-700 z-50 overflow-y-auto animate-slide-in-right" id="issue-drawer">
        {/* Header */}
        <div className="sticky top-0 bg-surface-900/95 backdrop-blur-sm border-b border-surface-800 p-5 flex items-center justify-between">
          <h3 className="text-lg font-bold text-white">Finding Detail</h3>
          <button onClick={closeIssueDrawer} className="btn-ghost p-1.5" id="close-issue-drawer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-6">
          {/* Severity & Status */}
          <div className="flex items-center gap-3">
            <span className={severityColor(selectedIssue.severity)}>{selectedIssue.severity || 'N/A'}</span>
            <span className={`text-sm font-medium ${statusColor(selectedIssue.status)}`}>{selectedIssue.status || 'N/A'}</span>
            <span className="text-xs text-surface-600 bg-surface-800 px-2 py-1 rounded-lg">{selectedIssue.agent_source || 'N/A'}</span>
          </div>

          {/* Issue Type */}
          <div>
            <p className="text-xs text-surface-500 uppercase tracking-wider mb-1">Issue Type</p>
            <FieldValue value={selectedIssue.issue_type} className="text-white font-semibold" />
          </div>

          {/* Drawing Reference */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-surface-500 uppercase tracking-wider mb-1">Drawing Ref</p>
              <FieldValue value={selectedIssue.drawing_ref} />
            </div>
            <div>
              <p className="text-xs text-surface-500 uppercase tracking-wider mb-1">Location</p>
              <FieldValue value={selectedIssue.location} />
            </div>
          </div>

          {/* Description */}
          <div>
            <p className="text-xs text-surface-500 uppercase tracking-wider mb-1">Description</p>
            <div className="p-3 rounded-xl bg-surface-800/50 border border-surface-700/50">
              <FieldValue value={selectedIssue.description} className="text-surface-200 text-sm leading-relaxed" />
            </div>
          </div>

          {/* Suggested Fix */}
          <div>
            <p className="text-xs text-surface-500 uppercase tracking-wider mb-1">Suggested Fix</p>
            <div className="p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/15">
              <FieldValue value={selectedIssue.suggested_fix} className="text-emerald-300 text-sm leading-relaxed" />
            </div>
          </div>

          {/* Code Clause */}
          <div>
            <p className="text-xs text-surface-500 uppercase tracking-wider mb-1">Code Reference</p>
            <div className="p-3 rounded-xl bg-brand-500/5 border border-brand-500/15">
              <FieldValue value={selectedIssue.code_clause} className="text-brand-300 text-sm font-mono" />
            </div>
          </div>

          {/* Action Buttons — Accept/Reject for Open issues */}
          {isOpen && (
            <div className="space-y-3 pt-2">
              <div className="grid grid-cols-2 gap-3">
                <button
                  className="btn-primary justify-center"
                  onClick={() => acceptMutation.mutate()}
                  disabled={anyLoading}
                  id="accept-issue-btn"
                >
                  {acceptMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                  Accept
                </button>
                <button
                  className="btn-secondary justify-center"
                  onClick={() => rejectMutation.mutate()}
                  disabled={anyLoading}
                  id="reject-issue-btn"
                >
                  {rejectMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                  Reject
                </button>
              </div>
            </div>
          )}

          {/* NCR/RFI Buttons — available for both Open AND Accepted issues */}
          {(canRaiseNCR || canRaiseRFI) && (
            <div className="space-y-3">
              {isAccepted && (
                <p className="text-xs text-surface-500 uppercase tracking-wider">Actions</p>
              )}
              <div className="grid grid-cols-2 gap-3">
                {canRaiseNCR && (
                  <button
                    className="btn-danger justify-center"
                    onClick={() => ncrMutation.mutate()}
                    disabled={anyLoading}
                    id="raise-ncr-btn"
                  >
                    {ncrMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                    Raise NCR
                  </button>
                )}
                {canRaiseRFI && (
                  <button
                    className="btn-secondary justify-center"
                    onClick={() => rfiMutation.mutate()}
                    disabled={anyLoading}
                    id="raise-rfi-btn"
                  >
                    {rfiMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageSquare className="w-4 h-4" />}
                    Raise RFI
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

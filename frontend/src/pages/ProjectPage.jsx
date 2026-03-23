import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useDropzone } from 'react-dropzone';
import {
  Upload, Play, FileText, AlertTriangle, ClipboardList, MessageSquare,
  Download, ArrowLeft, Loader2, CheckCircle, Eye, RefreshCw, File,
  Zap, Brain, ScanEye, Sparkles, BarChart3, Shield, FileDown, Wrench
} from 'lucide-react';
import {
  getProject, getProjectFiles, getProjectIssues, getProjectNCRs,
  getProjectRFIs, uploadFiles, triggerReview, getReviewStatus, exportReport,
  connectReviewSSE, exportReportDocx
} from '../lib/api';
import { useUIStore } from '../stores';
import { severityColor, statusColor, downloadBlob } from '../lib/utils';
import IssuePanel from '../components/IssuePanel';
import IssueDetailModal from '../components/IssueDetailModal';

const TABS = ['Drawings', 'Issues', 'NCR Log', 'RFI Log', 'Reports'];

const AGENT_META = {
  groq: { label: 'Speed Agent', icon: Zap, color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/20' },
  vision: { label: 'Vision Agent', icon: ScanEye, color: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/20' },
  openai: { label: 'Deep Reasoning Agent', icon: Brain, color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
  summary: { label: 'Summary Agent', icon: Sparkles, color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
};

function AgentProgressBar({ agentKey, data }) {
  const meta = AGENT_META[agentKey];
  if (!meta || !data) return null;
  const Icon = meta.icon;
  const pct = data.progress || 0;
  const isComplete = data.status === 'complete';

  return (
    <div className={`p-3 rounded-xl ${meta.bg} border ${meta.border} transition-all duration-300`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Icon className={`w-4 h-4 ${meta.color}`} />
          <span className={`text-sm font-medium ${meta.color}`}>{meta.label}</span>
        </div>
        <div className="flex items-center gap-2">
          {data.findings > 0 && (
            <span className="text-xs text-surface-400">{data.findings} findings</span>
          )}
          {isComplete ? (
            <CheckCircle className="w-4 h-4 text-emerald-400" />
          ) : (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-surface-400" />
          )}
        </div>
      </div>
      <div className="w-full h-1.5 bg-surface-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ease-out ${
            isComplete ? 'bg-emerald-500' : 'bg-gradient-to-r from-brand-500 to-brand-400'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function ReviewProgressPanel({ sseData, isReviewing }) {
  if (!isReviewing && !sseData) return null;

  const overall = sseData?.overall || { stage: 'waiting', progress: 0 };
  const agents = sseData?.agents || {};
  const summaryData = sseData?.summary;
  const overallPct = overall.progress || 0;

  const stageLabels = {
    waiting: 'Preparing review...',
    starting: 'Initializing agents...',
    agents_phase1: 'Phase 1: Speed + Vision agents (concurrent)',
    agents_phase2: 'Phase 2: Deep Reasoning Agent',
    dedup_summary: 'Deduplicating & generating summary...',
    complete: 'Review complete!',
    failed: 'Review failed',
  };

  return (
    <div className="glass-card p-5 space-y-4 animate-fade-in border border-brand-500/20">
      {/* Overall Progress Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-brand-500/10">
            <BarChart3 className="w-5 h-5 text-brand-400" />
          </div>
          <div>
            <h3 className="text-white font-semibold text-sm">AI Review Progress</h3>
            <p className="text-surface-400 text-xs">{stageLabels[overall.stage] || overall.stage}</p>
          </div>
        </div>
        <span className="text-brand-400 font-bold text-lg">{overallPct}%</span>
      </div>

      {/* Overall Progress Bar */}
      <div className="w-full h-2 bg-surface-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ease-out ${
            overall.stage === 'complete'
              ? 'bg-gradient-to-r from-emerald-500 to-emerald-400'
              : overall.stage === 'failed'
              ? 'bg-red-500'
              : 'bg-gradient-to-r from-brand-600 via-brand-500 to-brand-400'
          }`}
          style={{ width: `${overallPct}%` }}
        />
      </div>

      {/* Per-Agent Progress */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {Object.entries(agents).map(([key, data]) => (
          <AgentProgressBar key={key} agentKey={key} data={data} />
        ))}
      </div>

      {/* Finding Count */}
      {sseData?.finding_count > 0 && (
        <div className="flex items-center gap-2 text-sm">
          <Shield className="w-4 h-4 text-amber-400" />
          <span className="text-surface-300">
            <strong className="text-white">{sseData.finding_count}</strong> unique findings identified
          </span>
        </div>
      )}

      {/* Executive Summary */}
      {summaryData?.executive_summary && (
        <div className="p-4 rounded-xl bg-surface-800/50 border border-surface-700/50 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-surface-500 uppercase tracking-wider font-medium">Executive Summary</span>
            {summaryData.overall_confidence != null && (
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                summaryData.overall_confidence >= 0.8
                  ? 'bg-emerald-500/10 text-emerald-400'
                  : summaryData.overall_confidence >= 0.6
                  ? 'bg-amber-500/10 text-amber-400'
                  : 'bg-red-500/10 text-red-400'
              }`}>
                Confidence: {Math.round(summaryData.overall_confidence * 100)}%
              </span>
            )}
          </div>
          <p className="text-surface-200 text-sm leading-relaxed">{summaryData.executive_summary}</p>
          {summaryData.top_risk_areas?.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {summaryData.top_risk_areas.map((area, i) => (
                <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20">
                  {area}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ProjectPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('Drawings');
  const openIssueDrawer = useUIStore((s) => s.openIssueDrawer);
  const openIssueModal = useUIStore((s) => s.openIssueModal);
  const [sseData, setSseData] = useState(null);
  const sseCleanupRef = useRef(null);

  const { data: project } = useQuery({ queryKey: ['project', id], queryFn: () => getProject(id) });
  const { data: files = [] } = useQuery({ queryKey: ['files', id], queryFn: () => getProjectFiles(id) });
  const { data: issues = [] } = useQuery({ queryKey: ['issues', id], queryFn: () => getProjectIssues(id), refetchInterval: 5000 });
  const { data: ncrs = [] } = useQuery({ queryKey: ['ncrs', id], queryFn: () => getProjectNCRs(id), refetchInterval: 5000 });
  const { data: rfis = [] } = useQuery({ queryKey: ['rfis', id], queryFn: () => getProjectRFIs(id), refetchInterval: 5000 });
  const { data: reviewStatus } = useQuery({ queryKey: ['review-status', id], queryFn: () => getReviewStatus(id), refetchInterval: 3000 });

  // Cleanup SSE on unmount
  useEffect(() => {
    return () => {
      if (sseCleanupRef.current) {
        sseCleanupRef.current();
      }
    };
  }, []);

  // Auto-connect SSE when page loads with an in-progress review
  useEffect(() => {
    if (
      reviewStatus &&
      (reviewStatus.status === 'In Progress' || reviewStatus.status === 'Pending') &&
      !sseData &&
      !sseCleanupRef.current
    ) {
      const cleanup = connectReviewSSE(
        id,
        (data) => setSseData(data),
        () => {}
      );
      sseCleanupRef.current = cleanup;
    }
  }, [reviewStatus, sseData, id]);

  // Auto-switch to Issues tab when review completes
  useEffect(() => {
    if (sseData?.status === 'Complete') {
      queryClient.invalidateQueries({ queryKey: ['issues', id] });
      queryClient.invalidateQueries({ queryKey: ['project', id] });
      queryClient.invalidateQueries({ queryKey: ['review-status', id] });
      // Switch to Issues tab after a short delay
      setTimeout(() => setActiveTab('Issues'), 1500);
    }
  }, [sseData?.status, id, queryClient]);

  const uploadMutation = useMutation({
    mutationFn: (acceptedFiles) => uploadFiles(id, acceptedFiles),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files', id] });
      queryClient.invalidateQueries({ queryKey: ['project', id] });
      queryClient.invalidateQueries({ queryKey: ['review-status', id] });

      // Backend auto-triggers review after upload — connect SSE for live progress
      if (sseCleanupRef.current) {
        sseCleanupRef.current();
        sseCleanupRef.current = null;
      }
      setSseData(null);
      const cleanup = connectReviewSSE(
        id,
        (data) => setSseData(data),
        () => {}
      );
      sseCleanupRef.current = cleanup;
    },
  });

  const reviewMutation = useMutation({
    mutationFn: () => triggerReview(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['review-status', id] });
      if (sseCleanupRef.current) {
        sseCleanupRef.current();
        sseCleanupRef.current = null;
      }
      setSseData(null);
      const cleanup = connectReviewSSE(
        id,
        (data) => setSseData(data),
        (err) => console.error('SSE error:', err)
      );
      sseCleanupRef.current = cleanup;
    },
  });

  const onDrop = useCallback((accepted) => uploadMutation.mutate(accepted), [uploadMutation]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
    },
  });

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(null);

  const handleExport = async () => {
    try {
      setExporting(true);
      setExportError(null);
      const blob = await exportReport(id);
      downloadBlob(blob, `${project?.name || 'report'}_QA_Report.pdf`);
    } catch (err) {
      setExportError(err.response?.data?.detail || err.message || 'Failed to export report. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  const [exportingDocx, setExportingDocx] = useState(false);
  const handleExportDocx = async () => {
    try {
      setExportingDocx(true);
      setExportError(null);
      const blob = await exportReportDocx(id);
      downloadBlob(blob, `${project?.name || 'report'}_QA_Report.docx`);
    } catch (err) {
      setExportError(err.response?.data?.detail || err.message || 'Failed to export Word report.');
    } finally {
      setExportingDocx(false);
    }
  };

  const isReviewing = reviewStatus?.status === 'In Progress' || reviewStatus?.status === 'Pending';

  return (
    <div className="space-y-6 animate-fade-in">
      <IssuePanel projectId={id} />
      <IssueDetailModal projectId={id} />

      {/* Header */}
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/')} className="btn-ghost p-2" id="back-to-dashboard">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-white">{project?.name || 'Loading...'}</h1>
          <p className="text-surface-400 text-sm">{project?.description}</p>
        </div>
        <div className="flex items-center gap-3">
          {reviewStatus?.status && (
            <span className={`text-sm font-medium px-3 py-1.5 rounded-lg ${
              reviewStatus.status === 'Complete' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
              reviewStatus.status === 'In Progress' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
              reviewStatus.status === 'Failed' ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
              'bg-surface-800 text-surface-400 border border-surface-700'
            }`}>
              {isReviewing && <Loader2 className="w-3.5 h-3.5 animate-spin inline mr-1.5" />}
              {reviewStatus.status === 'Complete' && <CheckCircle className="w-3.5 h-3.5 inline mr-1.5" />}
              {reviewStatus.status}
            </span>
          )}
          <button
            className="btn-primary"
            onClick={() => reviewMutation.mutate()}
            disabled={files.length === 0 || isReviewing}
            id="trigger-review-btn"
          >
            {isReviewing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            {isReviewing ? 'Reviewing...' : 'Run AI Review'}
          </button>
        </div>
      </div>

      {/* Live Review Progress Panel — use sseData or polled progress as fallback */}
      <ReviewProgressPanel
        sseData={sseData || (reviewStatus?.progress ? {
          overall: reviewStatus.progress.overall || { stage: 'waiting', progress: 0 },
          agents: reviewStatus.progress.groq || reviewStatus.progress.vision || reviewStatus.progress.openai
            ? Object.fromEntries(
                ['groq', 'vision', 'openai', 'summary']
                  .filter(k => reviewStatus.progress[k])
                  .map(k => [k, reviewStatus.progress[k]])
              )
            : {},
          status: reviewStatus.status,
          finding_count: reviewStatus.finding_count || 0,
          summary: reviewStatus.summary,
        } : null)}
        isReviewing={isReviewing}
      />

      {/* Tabs */}
      <div className="flex items-center gap-1 p-1 bg-surface-900/50 rounded-xl border border-surface-800 w-fit">
        {TABS.map((tab) => (
          <button
            key={tab}
            className={activeTab === tab ? 'tab-btn-active' : 'tab-btn'}
            onClick={() => setActiveTab(tab)}
            id={`tab-${tab.toLowerCase().replace(/\s/g, '-')}`}
          >
            {tab}
            {tab === 'Issues' && issues.length > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 text-xs bg-amber-500/20 text-amber-400 rounded-full">{issues.length}</span>
            )}
            {tab === 'NCR Log' && ncrs.length > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 text-xs bg-red-500/20 text-red-400 rounded-full">{ncrs.length}</span>
            )}
            {tab === 'RFI Log' && rfis.length > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 text-xs bg-blue-500/20 text-blue-400 rounded-full">{rfis.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="animate-fade-in">
        {activeTab === 'Drawings' && (
          <div className="space-y-4">
            {/* Dropzone */}
            <div
              {...getRootProps()}
              className={`glass-card border-2 border-dashed p-8 text-center cursor-pointer transition-all duration-200 ${
                isDragActive ? 'border-brand-500 bg-brand-500/5' : 'border-surface-700 hover:border-surface-500'
              }`}
              id="file-dropzone"
            >
              <input {...getInputProps()} />
              <Upload className={`w-10 h-10 mx-auto mb-3 ${isDragActive ? 'text-brand-400' : 'text-surface-500'}`} />
              {uploadMutation.isPending ? (
                <p className="text-surface-300"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Uploading...</p>
              ) : isDragActive ? (
                <p className="text-brand-400 font-medium">Drop files here...</p>
              ) : (
                <>
                  <p className="text-surface-300 font-medium">Drag & drop PDF, DOCX, or XLSX files</p>
                  <p className="text-surface-500 text-sm mt-1">or click to browse</p>
                </>
              )}
            </div>

            {/* File List */}
            {files.length > 0 && (
              <div className="space-y-2">
                {files.map((f) => (
                  <div key={f.id} className="glass-card p-4 flex items-center justify-between" id={`file-${f.id}`}>
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-brand-500/10">
                        <File className="w-5 h-5 text-brand-400" />
                      </div>
                      <div>
                        <p className="text-white font-medium text-sm">{f.filename}</p>
                        <p className="text-surface-500 text-xs">{f.type.toUpperCase()} · {f.pages} pages · {(f.size / 1024).toFixed(0)} KB</p>
                      </div>
                    </div>
                    {f.type === 'pdf' && (
                      <button
                        className="btn-ghost text-xs"
                        onClick={() => navigate(`/project/${id}/drawing/${f.id}`)}
                      >
                        <Eye className="w-4 h-4" /> View
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'Issues' && (
          <div className="space-y-2">
            {issues.length === 0 ? (
              <div className="glass-card p-12 text-center">
                <AlertTriangle className="w-10 h-10 text-surface-600 mx-auto mb-3" />
                <p className="text-surface-400">No issues found. Upload files and run an AI review.</p>
              </div>
            ) : (
              issues.map((issue) => (
                <div
                  key={issue.id}
                  className="glass-card-hover p-4 cursor-pointer"
                  onClick={() => openIssueModal(issue, 'issue')}
                  id={`issue-${issue.id}`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={severityColor(issue.severity)}>{issue.severity}</span>
                        <span className={`text-xs font-medium ${statusColor(issue.status)}`}>{issue.status}</span>
                      </div>
                      <p className="text-white font-medium text-sm">{issue.issue_type || 'N/A'}</p>
                      <p className="text-surface-400 text-sm mt-0.5 line-clamp-2">{issue.description || 'No description available.'}</p>
                      <p className="text-surface-500 text-xs mt-1">
                        {issue.drawing_ref || 'N/A'} · {issue.location || 'N/A'}
                        {issue.code_clause && ` · ${issue.code_clause}`}
                      </p>
                    </div>
                    <span className="text-xs text-surface-600 bg-surface-800 px-2 py-1 rounded-lg ml-3">{issue.agent_source || 'N/A'}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'NCR Log' && (
          <div className="space-y-2">
            {ncrs.length === 0 ? (
              <div className="glass-card p-12 text-center">
                <ClipboardList className="w-10 h-10 text-surface-600 mx-auto mb-3" />
                <p className="text-surface-400">No NCRs created yet. Accept issues to generate NCRs.</p>
              </div>
            ) : (
              ncrs.map((ncr) => (
                <div
                  key={ncr.id}
                  className="glass-card-hover p-4 cursor-pointer"
                  onClick={() => {
                    // Find the linked issue for this NCR, or create fallback from NCR data
                    const linkedIssue = issues.find(i => i.id === ncr.issue_id);
                    const issueForModal = linkedIssue || {
                      id: ncr.issue_id || ncr.id,
                      project_id: ncr.project_id,
                      drawing_ref: ncr.drawing_ref,
                      description: ncr.description,
                      code_clause: ncr.code_clause,
                      severity: ncr.severity,
                      issue_type: 'Non-Conformance',
                      status: 'Accepted',
                      agent_source: 'NCR',
                      location: '',
                      suggested_fix: '',
                    };
                    openIssueModal(issueForModal, 'ncr');
                  }}
                  id={`ncr-${ncr.id}`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-mono text-surface-500">NCR-{ncr.id.slice(0, 6).toUpperCase()}</span>
                        <span className={severityColor(ncr.severity)}>{ncr.severity}</span>
                      </div>
                      <p className="text-white font-medium text-sm">{ncr.description}</p>
                      <p className="text-surface-500 text-xs mt-1">{ncr.drawing_ref} {ncr.code_clause && `· ${ncr.code_clause}`}</p>
                    </div>
                    <span className="text-xs text-surface-600">{new Date(ncr.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'RFI Log' && (
          <div className="space-y-2">
            {rfis.length === 0 ? (
              <div className="glass-card p-12 text-center">
                <MessageSquare className="w-10 h-10 text-surface-600 mx-auto mb-3" />
                <p className="text-surface-400">No RFIs created yet. Escalate issues that need clarification.</p>
              </div>
            ) : (
              rfis.map((rfi) => (
                <div
                  key={rfi.id}
                  className="glass-card-hover p-4 cursor-pointer"
                  onClick={() => {
                    const linkedIssue = issues.find(i => i.id === rfi.issue_id);
                    const issueForModal = linkedIssue || {
                      id: rfi.issue_id || rfi.id,
                      project_id: rfi.project_id,
                      drawing_ref: rfi.drawing_ref,
                      description: rfi.description || rfi.question,
                      severity: 'Minor',
                      issue_type: 'Request for Information',
                      status: 'Escalated',
                      agent_source: 'RFI',
                      location: '',
                      suggested_fix: '',
                      code_clause: '',
                    };
                    openIssueModal(issueForModal, 'rfi');
                  }}
                  id={`rfi-${rfi.id}`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="text-xs font-mono text-surface-500">RFI-{rfi.id.slice(0, 6).toUpperCase()}</span>
                      <p className="text-white font-medium text-sm mt-1">{rfi.question}</p>
                      <p className="text-surface-500 text-xs mt-1">{rfi.drawing_ref}</p>
                    </div>
                    <span className="text-xs text-surface-600">{new Date(rfi.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'Reports' && (
          <div className="space-y-4">
            {/* Summary Stats */}
            {issues.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div className="glass-card p-4 text-center">
                  <p className="text-2xl font-bold text-white">{issues.length}</p>
                  <p className="text-xs text-surface-400 mt-1">Total Findings</p>
                </div>
                <div className="glass-card p-4 text-center border-red-500/20">
                  <p className="text-2xl font-bold text-red-400">{issues.filter(i => i.severity === 'Critical').length}</p>
                  <p className="text-xs text-surface-400 mt-1">Critical</p>
                </div>
                <div className="glass-card p-4 text-center border-amber-500/20">
                  <p className="text-2xl font-bold text-amber-400">{issues.filter(i => i.severity === 'Major').length}</p>
                  <p className="text-xs text-surface-400 mt-1">Major</p>
                </div>
                <div className="glass-card p-4 text-center border-blue-500/20">
                  <p className="text-2xl font-bold text-blue-400">{issues.filter(i => i.severity === 'Minor').length}</p>
                  <p className="text-xs text-surface-400 mt-1">Minor</p>
                </div>
              </div>
            )}

            {/* Executive Summary from Review */}
            {reviewStatus?.summary?.executive_summary && (
              <div className="glass-card p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-surface-500 uppercase tracking-wider font-medium">Executive Summary</span>
                  {reviewStatus.summary.overall_confidence != null && (
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      reviewStatus.summary.overall_confidence >= 0.8
                        ? 'bg-emerald-500/10 text-emerald-400'
                        : reviewStatus.summary.overall_confidence >= 0.6
                        ? 'bg-amber-500/10 text-amber-400'
                        : 'bg-red-500/10 text-red-400'
                    }`}>
                      Confidence: {Math.round(reviewStatus.summary.overall_confidence * 100)}%
                    </span>
                  )}
                </div>
                <p className="text-surface-200 text-sm leading-relaxed">{reviewStatus.summary.executive_summary}</p>
                {reviewStatus.summary.top_risk_areas?.length > 0 && (
                  <div>
                    <p className="text-xs text-surface-500 uppercase tracking-wider mb-1.5">Top Risk Areas</p>
                    <div className="flex flex-wrap gap-1.5">
                      {reviewStatus.summary.top_risk_areas.map((area, i) => (
                        <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20">
                          {area}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* NCR/RFI Summary */}
            {(ncrs.length > 0 || rfis.length > 0) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="glass-card p-4 flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-red-500/10">
                    <ClipboardList className="w-5 h-5 text-red-400" />
                  </div>
                  <div>
                    <p className="text-white font-semibold">{ncrs.length} NCR{ncrs.length !== 1 ? 's' : ''}</p>
                    <p className="text-xs text-surface-400">Non-Conformance Reports raised</p>
                  </div>
                </div>
                <div className="glass-card p-4 flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-blue-500/10">
                    <MessageSquare className="w-5 h-5 text-blue-400" />
                  </div>
                  <div>
                    <p className="text-white font-semibold">{rfis.length} RFI{rfis.length !== 1 ? 's' : ''}</p>
                    <p className="text-xs text-surface-400">Requests for Information raised</p>
                  </div>
                </div>
              </div>
            )}

            {/* Download Report */}
            <div className="glass-card p-8 text-center space-y-4">
              <FileText className="w-12 h-12 text-brand-400 mx-auto" />
              <div>
                <h3 className="text-lg font-semibold text-white">Export QA/QC Report</h3>
                <p className="text-surface-400 text-sm mt-1">
                  {issues.length > 0
                    ? 'Download a comprehensive PDF report with all findings, severities, and code references.'
                    : 'No findings to report yet. Upload files and run an AI review first.'}
                </p>
              </div>
              {exportError && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                  {exportError}
                </div>
              )}
              <button
                className="btn-primary"
                onClick={handleExport}
                disabled={issues.length === 0 || exporting}
                id="export-report-btn"
              >
                {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                {exporting ? 'Generating PDF...' : 'Download Report PDF'}
              </button>
              <button
                className="btn-secondary"
                onClick={handleExportDocx}
                disabled={issues.length === 0 || exportingDocx}
                id="export-report-docx-btn"
              >
                {exportingDocx ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
                {exportingDocx ? 'Generating Word...' : 'Download Word Report'}
              </button>
            </div>

            {/* Fixed Issues Section */}
            {issues.filter(i => i.status === 'Fixed').length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Wrench className="w-5 h-5 text-emerald-400" />
                  <h3 className="text-lg font-semibold text-white">Fixed Issues</h3>
                  <span className="px-2 py-0.5 text-xs bg-emerald-500/20 text-emerald-400 rounded-full">
                    {issues.filter(i => i.status === 'Fixed').length}
                  </span>
                </div>
                {issues.filter(i => i.status === 'Fixed').map((issue) => (
                  <div
                    key={issue.id}
                    className="glass-card p-4 cursor-pointer border-emerald-500/20 hover:border-emerald-500/40 transition-colors"
                    onClick={() => openIssueModal(issue, 'issue')}
                    id={`fixed-issue-${issue.id}`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <CheckCircle className="w-4 h-4 text-emerald-400" />
                          <span className={severityColor(issue.severity)}>{issue.severity}</span>
                          <span className="text-xs font-medium text-emerald-400">✓ Fixed</span>
                        </div>
                        <p className="text-white font-medium text-sm">{issue.issue_type || 'N/A'}</p>
                        <p className="text-surface-400 text-sm mt-0.5 line-clamp-1">{issue.description || 'No description'}</p>
                        <p className="text-surface-500 text-xs mt-1">
                          {issue.drawing_ref || 'N/A'} · {issue.location || 'N/A'}
                        </p>
                      </div>
                      <button
                        className="btn-ghost text-xs ml-3 shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          openIssueModal(issue, 'issue');
                        }}
                      >
                        <Eye className="w-4 h-4" /> View Fix
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

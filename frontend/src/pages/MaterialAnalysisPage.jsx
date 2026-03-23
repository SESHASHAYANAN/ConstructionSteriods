import React, { useState, useCallback } from 'react';
import {
  FlaskConical, Upload, CheckCircle2, XCircle, AlertTriangle,
  Camera, Loader2, ChevronDown, ShieldCheck, Eye, Package
} from 'lucide-react';
import api from '../lib/api';

const MATERIAL_TYPES = ['Auto-Detect', 'Cement', 'Bricks', 'Rebar', 'Aggregate', 'Steel', 'Timber'];

const VERDICT_CONFIG = {
  PASS: { color: 'text-emerald-400', bg: 'bg-emerald-500/15', border: 'border-emerald-500/25', icon: CheckCircle2, label: 'PASS — Material Conforms' },
  FAIL: { color: 'text-red-400', bg: 'bg-red-500/15', border: 'border-red-500/25', icon: XCircle, label: 'FAIL — Non-Conforming' },
  REVIEW: { color: 'text-amber-400', bg: 'bg-amber-500/15', border: 'border-amber-500/25', icon: AlertTriangle, label: 'REVIEW — Manual Check Needed' },
};

const SEVERITY_BADGE = {
  Critical: 'badge-critical',
  Major: 'badge-major',
  Minor: 'badge-minor',
};

export default function MaterialAnalysisPage() {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [materialType, setMaterialType] = useState('Auto-Detect');
  const [expectedSpec, setExpectedSpec] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [dragActive, setDragActive] = useState(false);

  const handleFile = useCallback((f) => {
    if (f && f.type?.startsWith('image/')) {
      setFile(f);
      setError('');
      const reader = new FileReader();
      reader.onload = (e) => setPreview(e.target.result);
      reader.readAsDataURL(f);
    } else {
      setError('Please upload an image file (JPG, PNG, etc.)');
    }
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files?.[0]) handleFile(e.dataTransfer.files[0]);
  }, [handleFile]);

  const handleAnalyze = async () => {
    if (!file) return;
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('material_type', materialType);
      form.append('expected_spec', expectedSpec);
      const res = await api.post('/materials/analyze', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120000,
      });
      setResult(res.data);
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Analysis failed.');
    } finally {
      setLoading(false);
    }
  };

  const verdict = result?.verdict && VERDICT_CONFIG[result.verdict];

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="p-3 rounded-2xl bg-gradient-to-br from-teal-500 to-cyan-600 shadow-lg shadow-teal-500/20">
          <FlaskConical className="w-7 h-7 text-white" />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Material Quality Analysis</h1>
          <p className="text-surface-400 mt-1">AI Vision-powered material inspection — verify cement, bricks, rebar and more</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Left: Upload & Config */}
        <div className="space-y-6">
          {/* Upload Zone */}
          <div className="glass-card p-6">
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <Camera className="w-5 h-5 text-teal-400" /> Upload Material Photo
            </h2>
            <div
              className={`relative border-2 border-dashed rounded-2xl p-8 text-center transition-all duration-300 cursor-pointer ${
                dragActive
                  ? 'border-teal-400 bg-teal-500/10'
                  : preview
                  ? 'border-surface-600 bg-surface-800/50'
                  : 'border-surface-600 hover:border-teal-500/50 hover:bg-surface-800/30'
              }`}
              onDrop={handleDrop}
              onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
              onDragLeave={() => setDragActive(false)}
              onClick={() => document.getElementById('material-file-input')?.click()}
            >
              {preview ? (
                <div className="space-y-3">
                  <img src={preview} alt="Material preview" className="max-h-64 mx-auto rounded-xl shadow-lg" />
                  <p className="text-surface-400 text-sm">{file?.name} — Click to change</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <Upload className="w-12 h-12 text-surface-500 mx-auto" />
                  <p className="text-surface-300 font-medium">Drop a material photo here or click to browse</p>
                  <p className="text-surface-500 text-sm">Supports JPG, PNG, BMP, TIFF</p>
                </div>
              )}
              <input
                id="material-file-input"
                type="file"
                className="hidden"
                accept="image/*"
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              />
            </div>
          </div>

          {/* Configuration */}
          <div className="glass-card p-6 space-y-4">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Package className="w-5 h-5 text-teal-400" /> Analysis Settings
            </h2>
            <div>
              <label className="block text-sm font-medium text-surface-300 mb-2">Material Type</label>
              <div className="relative">
                <select
                  value={materialType}
                  onChange={(e) => setMaterialType(e.target.value)}
                  className="input-field appearance-none pr-10"
                  id="material-type-select"
                >
                  {MATERIAL_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-500 pointer-events-none" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-300 mb-2">Expected Specification</label>
              <input
                type="text"
                value={expectedSpec}
                onChange={(e) => setExpectedSpec(e.target.value)}
                placeholder="e.g., OPC 53 Grade, IS 269:2015, Fe 500D"
                className="input-field"
                id="expected-spec-input"
              />
            </div>
            <button
              onClick={handleAnalyze}
              disabled={!file || loading}
              className="btn-primary w-full"
              id="analyze-material-btn"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" /> Analyzing with AI Vision...
                </>
              ) : (
                <>
                  <Eye className="w-5 h-5" /> Analyze Material
                </>
              )}
            </button>
            {error && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/25 text-red-400 text-sm">
                {error}
              </div>
            )}
          </div>
        </div>

        {/* Right: Results */}
        <div className="space-y-6">
          {!result && !loading && (
            <div className="glass-card p-12 text-center">
              <ShieldCheck className="w-16 h-16 text-surface-600 mx-auto mb-4" />
              <p className="text-surface-400 text-lg">Upload a material photo to begin analysis</p>
              <p className="text-surface-500 text-sm mt-2">The AI will verify quality, grade markings, and specification compliance</p>
            </div>
          )}

          {loading && (
            <div className="glass-card p-12 text-center">
              <Loader2 className="w-16 h-16 text-teal-400 mx-auto mb-4 animate-spin" />
              <p className="text-surface-300 text-lg font-medium">Analyzing Material...</p>
              <p className="text-surface-500 text-sm mt-2">AI Vision is inspecting the image for quality and compliance</p>
            </div>
          )}

          {result && (
            <>
              {/* Verdict */}
              {verdict && (
                <div className={`glass-card p-6 ${verdict.bg} border ${verdict.border}`}>
                  <div className="flex items-center gap-4">
                    <verdict.icon className={`w-10 h-10 ${verdict.color}`} />
                    <div>
                      <p className={`text-2xl font-bold ${verdict.color}`}>{verdict.label}</p>
                      <p className="text-surface-400 text-sm mt-1">
                        Confidence: <span className="text-white font-semibold">{Math.round((result.confidence || 0) * 100)}%</span>
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Summary */}
              {result.summary && (
                <div className="glass-card p-6">
                  <h3 className="text-sm font-semibold text-surface-400 uppercase tracking-wider mb-2">Summary</h3>
                  <p className="text-surface-200">{result.summary}</p>
                </div>
              )}

              {/* Detection Info */}
              <div className="glass-card p-6">
                <h3 className="text-sm font-semibold text-surface-400 uppercase tracking-wider mb-4">Detection Details</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 rounded-xl bg-surface-800/50">
                    <p className="text-xs text-surface-500 mb-1">Material Detected</p>
                    <p className="text-white font-semibold">{result.material_detected || 'N/A'}</p>
                  </div>
                  <div className="p-3 rounded-xl bg-surface-800/50">
                    <p className="text-xs text-surface-500 mb-1">Physical Condition</p>
                    <p className="text-white font-semibold">{result.physical_condition || 'N/A'}</p>
                  </div>
                  <div className="p-3 rounded-xl bg-surface-800/50">
                    <p className="text-xs text-surface-500 mb-1">Brand Identified</p>
                    <p className="text-white font-semibold">{result.brand_identified || 'N/A'}</p>
                  </div>
                  <div className="p-3 rounded-xl bg-surface-800/50">
                    <p className="text-xs text-surface-500 mb-1">Storage Assessment</p>
                    <p className="text-white font-semibold">{result.storage_assessment || 'N/A'}</p>
                  </div>
                </div>
              </div>

              {/* Spec Comparison */}
              {result.spec_comparison && (
                <div className="glass-card p-6">
                  <h3 className="text-sm font-semibold text-surface-400 uppercase tracking-wider mb-4">Specification Comparison</h3>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center p-3 rounded-xl bg-surface-800/50">
                      <span className="text-surface-400 text-sm">Expected</span>
                      <span className="text-white font-medium">{result.spec_comparison.expected || 'N/A'}</span>
                    </div>
                    <div className="flex justify-between items-center p-3 rounded-xl bg-surface-800/50">
                      <span className="text-surface-400 text-sm">Observed</span>
                      <span className="text-white font-medium">{result.spec_comparison.observed || 'N/A'}</span>
                    </div>
                    <div className={`flex justify-between items-center p-3 rounded-xl ${
                      result.spec_comparison.conformity === 'Conforms' ? 'bg-emerald-500/10 border border-emerald-500/25' :
                      result.spec_comparison.conformity === 'Non-Conforming' ? 'bg-red-500/10 border border-red-500/25' :
                      'bg-amber-500/10 border border-amber-500/25'
                    }`}>
                      <span className="text-surface-400 text-sm">Conformity</span>
                      <span className="font-bold">{result.spec_comparison.conformity || 'N/A'}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Issues */}
              {result.issues?.length > 0 && (
                <div className="glass-card p-6">
                  <h3 className="text-sm font-semibold text-surface-400 uppercase tracking-wider mb-4">
                    Issues Found ({result.issues.length})
                  </h3>
                  <div className="space-y-3">
                    {result.issues.map((issue, idx) => (
                      <div key={idx} className="p-4 rounded-xl bg-surface-800/50 border border-surface-700/50">
                        <div className="flex items-center gap-3 mb-2">
                          <span className={SEVERITY_BADGE[issue.severity] || 'badge-minor'}>
                            {issue.severity}
                          </span>
                          <span className="text-white font-semibold text-sm">{issue.type}</span>
                        </div>
                        <p className="text-surface-300 text-sm">{issue.description}</p>
                        {issue.standard_reference && issue.standard_reference !== 'N/A' && (
                          <p className="text-surface-500 text-xs mt-2">Ref: {issue.standard_reference}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recommendations */}
              {result.recommendations?.length > 0 && (
                <div className="glass-card p-6">
                  <h3 className="text-sm font-semibold text-surface-400 uppercase tracking-wider mb-4">Recommendations</h3>
                  <ul className="space-y-2">
                    {result.recommendations.map((rec, idx) => (
                      <li key={idx} className="flex items-start gap-3 p-3 rounded-xl bg-surface-800/50">
                        <CheckCircle2 className="w-5 h-5 text-teal-400 mt-0.5 flex-shrink-0" />
                        <span className="text-surface-200 text-sm">{rec}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

import React, { useState, useCallback } from 'react';
import {
  ShieldAlert, FileText, Upload, Loader2, ChevronDown, AlertTriangle,
  CheckCircle2, XCircle, Info, Zap, BookOpen, ClipboardList
} from 'lucide-react';
import api from '../lib/api';

const DISCIPLINES = ['General', 'Structural', 'MEP Mechanical', 'MEP Electrical', 'MEP Plumbing', 'Architectural', 'Civil', 'Fire Protection'];
const CODE_OPTIONS = ['IBC','ACI 318','AISC 360','ASCE 7','Eurocode','BS EN','IS (Indian)','NFPA','ADA/ADAAG','ASHRAE'];

const RISK_COLORS = {
  Low: { bar: 'bg-emerald-500', text: 'text-emerald-400', bg: 'bg-emerald-500/15' },
  Medium: { bar: 'bg-amber-500', text: 'text-amber-400', bg: 'bg-amber-500/15' },
  High: { bar: 'bg-orange-500', text: 'text-orange-400', bg: 'bg-orange-500/15' },
  Critical: { bar: 'bg-red-500', text: 'text-red-400', bg: 'bg-red-500/15' },
};

export default function CompliancePage() {
  const [mode, setMode] = useState('text');
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);
  const [codes, setCodes] = useState([]);
  const [discipline, setDiscipline] = useState('General');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const toggleCode = (code) => {
    setCodes(prev => prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]);
  };

  const handleAnalyze = async () => {
    setLoading(true); setError(''); setResult(null);
    try {
      let res;
      if (mode === 'text') {
        if (text.trim().length < 20) { setError('Enter at least 20 characters.'); setLoading(false); return; }
        res = await api.post('/compliance/predict', { text, building_codes: codes, discipline }, { timeout: 120000 });
      } else {
        if (!file) { setError('Select a file to upload.'); setLoading(false); return; }
        const form = new FormData();
        form.append('file', file);
        form.append('building_codes', codes.join(','));
        form.append('discipline', discipline);
        res = await api.post('/compliance/predict-upload', form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 });
      }
      setResult(res.data);
    } catch (err) { setError(err.response?.data?.detail || err.message || 'Analysis failed.'); }
    finally { setLoading(false); }
  };

  const riskCfg = result?.risk_level ? RISK_COLORS[result.risk_level] || RISK_COLORS.Medium : null;

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="p-3 rounded-2xl bg-gradient-to-br from-orange-500 to-red-600 shadow-lg shadow-orange-500/20">
          <ShieldAlert className="w-7 h-7 text-white" />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Predictive Code Compliance</h1>
          <p className="text-surface-400 mt-1">AI-powered violation prediction — catch code issues before drawings finalize</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left: Input */}
        <div className="lg:col-span-2 space-y-6">
          <div className="glass-card p-6">
            {/* Mode Toggle */}
            <div className="flex gap-2 mb-6">
              <button onClick={() => setMode('text')} className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all ${mode==='text'?'bg-orange-600/20 text-orange-400 border border-orange-500/30':'bg-surface-800 text-surface-400 border border-surface-600/50'}`}>
                <FileText className="w-4 h-4" /> Paste Text
              </button>
              <button onClick={() => setMode('file')} className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all ${mode==='file'?'bg-orange-600/20 text-orange-400 border border-orange-500/30':'bg-surface-800 text-surface-400 border border-surface-600/50'}`}>
                <Upload className="w-4 h-4" /> Upload File
              </button>
            </div>

            {mode === 'text' ? (
              <textarea value={text} onChange={e => setText(e.target.value)} rows={12} className="input-field resize-y font-mono text-sm" placeholder="Paste draft specification, drawing notes, schedule data, or any engineering document content here for compliance scanning..." id="compliance-text-input" />
            ) : (
              <div className="border-2 border-dashed border-surface-600 rounded-2xl p-8 text-center hover:border-orange-500/50 transition-colors cursor-pointer" onClick={() => document.getElementById('compliance-file-input')?.click()}>
                {file ? (
                  <div><FileText className="w-12 h-12 text-orange-400 mx-auto mb-2" /><p className="text-white font-medium">{file.name}</p><p className="text-surface-500 text-sm mt-1">Click to change</p></div>
                ) : (
                  <div><Upload className="w-12 h-12 text-surface-500 mx-auto mb-2" /><p className="text-surface-300">Drop a PDF, DOCX, or TXT file here</p></div>
                )}
                <input id="compliance-file-input" type="file" className="hidden" accept=".pdf,.docx,.xlsx,.txt" onChange={e => e.target.files?.[0] && setFile(e.target.files[0])} />
              </div>
            )}

            <button onClick={handleAnalyze} disabled={loading} className="btn-primary w-full mt-4" id="analyze-compliance-btn">
              {loading ? <><Loader2 className="w-5 h-5 animate-spin" /> Analyzing Compliance...</> : <><Zap className="w-5 h-5" /> Predict Violations</>}
            </button>
            {error && <div className="mt-3 p-3 rounded-xl bg-red-500/10 border border-red-500/25 text-red-400 text-sm">{error}</div>}
          </div>
        </div>

        {/* Right: Config */}
        <div className="space-y-6">
          <div className="glass-card p-6">
            <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2"><BookOpen className="w-5 h-5 text-orange-400" /> Building Codes</h3>
            <div className="flex flex-wrap gap-2">
              {CODE_OPTIONS.map(code => (
                <button key={code} onClick={() => toggleCode(code)} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${codes.includes(code) ? 'bg-orange-600/20 text-orange-400 border border-orange-500/30' : 'bg-surface-800 text-surface-400 border border-surface-600/50 hover:text-surface-200'}`}>{code}</button>
              ))}
            </div>
          </div>
          <div className="glass-card p-6">
            <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2"><ClipboardList className="w-5 h-5 text-orange-400" /> Discipline</h3>
            <div className="relative">
              <select value={discipline} onChange={e => setDiscipline(e.target.value)} className="input-field appearance-none pr-8" id="compliance-discipline">
                {DISCIPLINES.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-500 pointer-events-none" />
            </div>
          </div>
        </div>
      </div>

      {/* Results */}
      {loading && (
        <div className="glass-card p-12 text-center">
          <Loader2 className="w-16 h-16 text-orange-400 mx-auto mb-4 animate-spin" />
          <p className="text-surface-300 text-lg font-medium">Scanning for Compliance Issues...</p>
        </div>
      )}

      {result && (
        <div className="space-y-6">
          {/* Risk Score */}
          <div className="glass-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">Risk Assessment</h3>
              {riskCfg && <span className={`px-4 py-1.5 rounded-full text-sm font-bold ${riskCfg.bg} ${riskCfg.text} border border-current/25`}>{result.risk_level} Risk</span>}
            </div>
            <div className="relative h-4 bg-surface-800 rounded-full overflow-hidden">
              <div className={`absolute left-0 top-0 h-full rounded-full transition-all duration-1000 ${riskCfg?.bar || 'bg-surface-600'}`} style={{ width: `${result.risk_score || 0}%` }} />
            </div>
            <p className="text-surface-400 text-sm mt-2">Risk Score: <span className="text-white font-bold">{result.risk_score}/100</span></p>
          </div>

          {/* Summary */}
          {result.summary && (
            <div className="glass-card p-6 border-l-4 border-orange-500">
              <h3 className="text-sm font-semibold text-surface-400 uppercase tracking-wider mb-2">Summary</h3>
              <p className="text-surface-200">{result.summary}</p>
            </div>
          )}

          {/* Violations */}
          {result.violations?.length > 0 && (
            <div className="glass-card p-6">
              <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <XCircle className="w-5 h-5 text-red-400" /> Violations & Predictions ({result.violations.length})
              </h3>
              <div className="space-y-3">
                {result.violations.map((v, i) => (
                  <div key={i} className="p-4 rounded-xl bg-surface-800/50 border border-surface-700/50">
                    <div className="flex items-center gap-3 mb-2 flex-wrap">
                      <span className={v.severity==='Critical'?'badge-critical':v.severity==='Major'?'badge-major':'badge-minor'}>{v.severity}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${v.type==='Violation'?'bg-red-500/15 text-red-400':'bg-amber-500/15 text-amber-400'} font-semibold`}>{v.type || 'Violation'}</span>
                      <span className="text-xs text-surface-500">{v.category}</span>
                    </div>
                    <p className="text-surface-200 text-sm">{v.description}</p>
                    {v.code && <p className="text-xs text-orange-400/80 mt-2 font-mono">{v.code}</p>}
                    {v.recommendation && <p className="text-xs text-surface-400 mt-1"><span className="text-teal-400 font-medium">Fix: </span>{v.recommendation}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Warnings */}
          {result.warnings?.length > 0 && (
            <div className="glass-card p-6">
              <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-amber-400" /> Early Warnings ({result.warnings.length})</h3>
              <div className="space-y-3">{result.warnings.map((w,i) => (
                <div key={i} className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/20">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${w.risk_probability==='High'?'bg-red-500/15 text-red-400':w.risk_probability==='Medium'?'bg-amber-500/15 text-amber-400':'bg-blue-500/15 text-blue-400'}`}>{w.risk_probability} Probability</span>
                  </div>
                  <p className="text-surface-200 text-sm">{w.description}</p>
                  {w.code && <p className="text-xs text-orange-400/80 mt-1 font-mono">{w.code}</p>}
                </div>
              ))}</div>
            </div>
          )}

          {/* Missing Info */}
          {result.missing_information?.length > 0 && (
            <div className="glass-card p-6">
              <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2"><Info className="w-5 h-5 text-blue-400" /> Missing Information ({result.missing_information.length})</h3>
              <div className="space-y-2">{result.missing_information.map((m,i) => (
                <div key={i} className="p-3 rounded-xl bg-surface-800/50 flex items-start gap-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold flex-shrink-0 mt-0.5 ${m.urgency==='High'?'bg-red-500/15 text-red-400':m.urgency==='Medium'?'bg-amber-500/15 text-amber-400':'bg-blue-500/15 text-blue-400'}`}>{m.urgency}</span>
                  <div><p className="text-white text-sm font-medium">{m.item}</p><p className="text-surface-400 text-xs mt-0.5">{m.impact}</p></div>
                </div>
              ))}</div>
            </div>
          )}

          {/* Recommendations */}
          {result.recommendations?.length > 0 && (
            <div className="glass-card p-6">
              <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2"><CheckCircle2 className="w-5 h-5 text-teal-400" /> Recommendations</h3>
              <div className="space-y-2">{result.recommendations.map((r,i) => (
                <div key={i} className="p-3 rounded-xl bg-surface-800/50 flex items-start gap-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold flex-shrink-0 mt-0.5 ${r.priority==='Immediate'?'bg-red-500/15 text-red-400':r.priority==='Before Finalization'?'bg-amber-500/15 text-amber-400':'bg-blue-500/15 text-blue-400'}`}>{r.priority}</span>
                  <div><p className="text-surface-200 text-sm">{r.action}</p>{r.code_reference && <p className="text-xs text-orange-400/80 mt-0.5 font-mono">{r.code_reference}</p>}</div>
                </div>
              ))}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

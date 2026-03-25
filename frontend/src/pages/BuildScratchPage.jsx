/**
 * BuildScratchPage — Upload house drawing → AI analyzes layout → materials + BOQ
 */
import React, { useState, useCallback } from 'react';
import {
  Upload, Loader2, Building2, Zap, Droplets, PencilRuler,
  IndianRupee, AlertCircle, CheckCircle, Package, BarChart3,
  Download, RefreshCw, FileImage
} from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import axios from 'axios';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const RESULT_TABS = ['Layout', 'Materials', 'Electrical', 'Plumbing', 'BOQ'];

function formatINR(num) {
  if (!num && num !== 0) return '—';
  return '₹' + Number(num).toLocaleString('en-IN');
}

export default function BuildScratchPage() {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState('');
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [activeTab, setActiveTab] = useState('Layout');
  const [areaSqft, setAreaSqft] = useState('');

  const onDrop = useCallback((accepted) => {
    if (accepted.length) {
      const f = accepted[0];
      setFile(f);
      setPreview(URL.createObjectURL(f));
      setError(null);
      setResult(null);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': ['.jpg', '.jpeg', '.png', '.webp'] },
    maxFiles: 1,
  });

  const handleAnalyze = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    setStage('Uploading drawing...');

    const formData = new FormData();
    formData.append('file', file);
    if (areaSqft) formData.append('area_sqft', areaSqft);

    try {
      setStage('AI analyzing floor plan layout...');
      const token = localStorage.getItem('token');
      const res = await axios.post(`${API}/build-scratch/analyze`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        timeout: 120000,
      });

      setResult(res.data);
      setActiveTab('Layout');
      setStage('');
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Analysis failed');
      setStage('');
    } finally {
      setLoading(false);
    }
  };

  const loadSample = async () => {
    setLoading(true);
    setStage('Loading sample...');
    try {
      const token = localStorage.getItem('token');
      const res = await axios.get(`${API}/build-scratch/sample`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      setResult(res.data);
      setActiveTab('Layout');
    } catch (err) {
      setError('Failed to load sample');
    } finally {
      setLoading(false);
      setStage('');
    }
  };

  const layout = result?.layout || {};
  const materials = result?.materials || {};
  const boq = materials?.boq || [];
  const costSummary = materials?.cost_summary || {};

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-white flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-gradient-to-br from-orange-500/20 to-amber-500/20 border border-orange-500/20">
            <Building2 className="w-7 h-7 text-orange-400" />
          </div>
          Build from Scratch
        </h1>
        <p className="text-surface-400 mt-1.5">Upload a house floor plan → AI analyzes layout → get materials, BOQ & cost estimates</p>
      </div>

      {/* Upload Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div
            {...getRootProps()}
            className={`glass-card border-2 border-dashed p-8 text-center cursor-pointer transition-all duration-200 min-h-[250px] flex flex-col items-center justify-center ${
              isDragActive ? 'border-orange-500 bg-orange-500/5' : 'border-surface-700 hover:border-surface-500'
            }`}
            id="build-scratch-dropzone"
          >
            <input {...getInputProps()} />
            {preview ? (
              <img src={preview} alt="Preview" className="max-h-[200px] rounded-lg border border-surface-700 object-contain" />
            ) : (
              <>
                <FileImage className={`w-12 h-12 mb-3 ${isDragActive ? 'text-orange-400' : 'text-surface-500'}`} />
                <p className="text-surface-300 font-medium">Drag & drop a house floor plan image</p>
                <p className="text-surface-500 text-sm mt-1">JPG, PNG, or WebP · Max 20MB</p>
              </>
            )}
          </div>

          {/* Area input */}
          <div>
            <label className="block text-sm font-medium text-surface-300 mb-1.5">Total Area (sq ft) — optional</label>
            <input
              className="input-field"
              type="number"
              placeholder="e.g. 1200"
              value={areaSqft}
              onChange={(e) => setAreaSqft(e.target.value)}
              id="build-area-input"
            />
          </div>

          <div className="flex gap-3">
            <button
              className="btn-primary flex-1"
              onClick={handleAnalyze}
              disabled={!file || loading}
              id="build-analyze-btn"
            >
              {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> {stage || 'Analyzing...'}</> : <><Zap className="w-4 h-4" /> Analyze Drawing</>}
            </button>
            <button className="btn-secondary" onClick={loadSample} disabled={loading} id="build-sample-btn">
              <Package className="w-4 h-4" /> Demo
            </button>
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" /> {error}
            </div>
          )}
        </div>

        {/* Quick summary card */}
        {result && (
          <div className="glass-card p-6 space-y-4">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-emerald-400" />
              <h3 className="text-lg font-semibold text-white">Analysis Complete</h3>
            </div>
            <p className="text-surface-300 text-sm">{layout.layout_summary || 'Floor plan analyzed'}</p>
            <div className="grid grid-cols-3 gap-3">
              <div className="p-3 rounded-xl bg-surface-800/50 text-center">
                <p className="text-xl font-bold text-white">{layout.total_area_sqft || '—'}</p>
                <p className="text-xs text-surface-500">sq ft</p>
              </div>
              <div className="p-3 rounded-xl bg-surface-800/50 text-center">
                <p className="text-xl font-bold text-white">{layout.rooms?.length || '—'}</p>
                <p className="text-xs text-surface-500">Rooms</p>
              </div>
              <div className="p-3 rounded-xl bg-surface-800/50 text-center">
                <p className="text-xl font-bold text-orange-400">{formatINR(costSummary.grand_total)}</p>
                <p className="text-xs text-surface-500">Est. Cost</p>
              </div>
            </div>
            {costSummary.cost_per_sqft && (
              <p className="text-sm text-surface-400">Cost per sq ft: <span className="text-orange-400 font-semibold">{formatINR(costSummary.cost_per_sqft)}</span></p>
            )}
          </div>
        )}
      </div>

      {/* Results Tabs */}
      {result && (
        <>
          <div className="flex items-center gap-1 p-1 bg-surface-900/50 rounded-xl border border-surface-800 w-fit">
            {RESULT_TABS.map((tab) => (
              <button
                key={tab}
                className={activeTab === tab ? 'tab-btn-active' : 'tab-btn'}
                onClick={() => setActiveTab(tab)}
                id={`build-tab-${tab.toLowerCase()}`}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="animate-fade-in">
            {/* Layout Tab */}
            {activeTab === 'Layout' && (
              <div className="glass-card p-6 space-y-4">
                <h3 className="text-lg font-semibold text-white">Room Layout Analysis</h3>
                {layout.rooms?.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {layout.rooms.map((room, i) => (
                      <div key={i} className="p-4 rounded-xl bg-surface-800/50 border border-surface-700/50">
                        <p className="text-white font-medium">{room.name}</p>
                        <p className="text-surface-400 text-sm capitalize">{room.type}</p>
                        <p className="text-surface-500 text-xs mt-1">{room.estimated_area_sqft} sq ft · {room.dimensions || '—'}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-surface-500">No room data available</p>
                )}
                {layout.structural_elements && (
                  <div className="p-4 rounded-xl bg-brand-500/5 border border-brand-500/15">
                    <p className="text-xs text-brand-400 uppercase tracking-wider font-semibold mb-2">Structural Elements</p>
                    <p className="text-surface-300 text-sm">Columns: {layout.structural_elements.columns || '—'} · Beams: {layout.structural_elements.beams || '—'}</p>
                    <p className="text-surface-400 text-sm">{layout.structural_elements.walls || '—'}</p>
                  </div>
                )}
              </div>
            )}

            {/* Materials Tab */}
            {activeTab === 'Materials' && (
              <div className="glass-card p-6 space-y-4">
                <h3 className="text-lg font-semibold text-white">Material Recommendations</h3>
                {materials.material_recommendations ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {Object.entries(materials.material_recommendations).map(([key, val]) => (
                      <div key={key} className="p-4 rounded-xl bg-surface-800/50 border border-surface-700/50">
                        <p className="text-white font-semibold capitalize">{key}</p>
                        <p className="text-orange-400 text-sm font-medium">{val.grade || val.type || '—'}</p>
                        <p className="text-surface-400 text-xs mt-1">{val.rationale || ''}</p>
                        {val.estimated_bags && <p className="text-surface-500 text-xs">Qty: {val.estimated_bags} bags</p>}
                        {val.estimated_quantity && <p className="text-surface-500 text-xs">Qty: {val.estimated_quantity}</p>}
                        {val.estimated_kg && <p className="text-surface-500 text-xs">Qty: {val.estimated_kg} kg</p>}
                        {val.estimated_cubic_meters && <p className="text-surface-500 text-xs">Qty: {val.estimated_cubic_meters} m³</p>}
                      </div>
                    ))}
                  </div>
                ) : <p className="text-surface-500">No material data</p>}
              </div>
            )}

            {/* Electrical Tab */}
            {activeTab === 'Electrical' && (
              <div className="glass-card p-6 space-y-4">
                <h3 className="text-lg font-semibold text-white flex items-center gap-2"><Zap className="w-5 h-5 text-yellow-400" /> Electrical Plan</h3>
                {materials.electrical ? (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {Object.entries(materials.electrical).filter(([, v]) => typeof v !== 'object').map(([key, val]) => (
                      <div key={key} className="p-3 rounded-xl bg-surface-800/50 text-center">
                        <p className="text-lg font-bold text-yellow-400">{val}</p>
                        <p className="text-xs text-surface-500 capitalize">{key.replace(/_/g, ' ')}</p>
                      </div>
                    ))}
                  </div>
                ) : <p className="text-surface-500">No electrical data</p>}
              </div>
            )}

            {/* Plumbing Tab */}
            {activeTab === 'Plumbing' && (
              <div className="glass-card p-6 space-y-4">
                <h3 className="text-lg font-semibold text-white flex items-center gap-2"><Droplets className="w-5 h-5 text-blue-400" /> Plumbing Plan</h3>
                {materials.plumbing ? (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {Object.entries(materials.plumbing).filter(([, v]) => typeof v !== 'object').map(([key, val]) => (
                        <div key={key} className="p-3 rounded-xl bg-surface-800/50 text-center">
                          <p className="text-lg font-bold text-blue-400">{typeof val === 'number' ? val : '—'}</p>
                          <p className="text-xs text-surface-500 capitalize">{key.replace(/_/g, ' ')}</p>
                        </div>
                      ))}
                    </div>
                    {materials.plumbing.fixtures && (
                      <div className="p-4 rounded-xl bg-blue-500/5 border border-blue-500/15">
                        <p className="text-xs text-blue-400 uppercase tracking-wider font-semibold mb-2">Fixtures</p>
                        <div className="flex gap-4 flex-wrap">
                          {Object.entries(materials.plumbing.fixtures).map(([k, v]) => (
                            <span key={k} className="text-surface-300 text-sm capitalize">{k.replace(/_/g, ' ')}: <em className="text-blue-400 font-medium">{v}</em></span>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : <p className="text-surface-500">No plumbing data</p>}
              </div>
            )}

            {/* BOQ Tab */}
            {activeTab === 'BOQ' && (
              <div className="glass-card p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-white flex items-center gap-2"><BarChart3 className="w-5 h-5 text-orange-400" /> Bill of Quantities</h3>
                </div>

                {/* Cost summary cards */}
                {costSummary && !costSummary.parse_error && (
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                    {['structural', 'finishing', 'electrical', 'plumbing', 'miscellaneous'].map((cat) => (
                      <div key={cat} className="p-3 rounded-xl bg-surface-800/50 text-center">
                        <p className="text-sm font-bold text-white">{formatINR(costSummary[cat])}</p>
                        <p className="text-xs text-surface-500 capitalize">{cat}</p>
                      </div>
                    ))}
                  </div>
                )}

                {boq.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-surface-800/50 text-surface-400 text-xs uppercase">
                          <th className="p-3 text-left">#</th>
                          <th className="p-3 text-left">Item</th>
                          <th className="p-3 text-center">Unit</th>
                          <th className="p-3 text-right">Qty</th>
                          <th className="p-3 text-right">Rate (₹)</th>
                          <th className="p-3 text-right">Amount (₹)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {boq.map((item, i) => (
                          <tr key={i} className="border-t border-surface-800 hover:bg-surface-800/30">
                            <td className="p-3 text-surface-500">{item.sno || i + 1}</td>
                            <td className="p-3 text-white">{item.item}</td>
                            <td className="p-3 text-center text-surface-400">{item.unit}</td>
                            <td className="p-3 text-right text-surface-300">{item.quantity?.toLocaleString()}</td>
                            <td className="p-3 text-right text-surface-400">{item.unit_rate?.toLocaleString()}</td>
                            <td className="p-3 text-right text-orange-400 font-medium">{formatINR(item.amount)}</td>
                          </tr>
                        ))}
                        <tr className="border-t-2 border-orange-500/30 bg-orange-500/5">
                          <td colSpan="5" className="p-3 text-right text-white font-bold">GRAND TOTAL</td>
                          <td className="p-3 text-right text-orange-400 font-bold text-lg">{formatINR(costSummary.grand_total)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                ) : <p className="text-surface-500">No BOQ data available</p>}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

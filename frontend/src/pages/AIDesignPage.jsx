/**
 * AIDesignPage — Generate optimized design alternatives with cost-reduction strategies.
 * Uses Gemini for design generation and SVG floor plan visualization.
 */
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Sparkles, Loader2, TrendingDown, Building, BarChart3,
  Leaf, AlertCircle, ChevronDown, ChevronUp, IndianRupee,
  Package, Lightbulb
} from 'lucide-react';
import { listProjects } from '../lib/api';
import axios from 'axios';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const GOALS = [
  { id: 'cost_reduction', label: 'Cost Reduction', icon: TrendingDown, color: 'text-emerald-400' },
  { id: 'structural_optimization', label: 'Structural Optimization', icon: Building, color: 'text-blue-400' },
  { id: 'energy_efficiency', label: 'Energy Efficiency', icon: Leaf, color: 'text-green-400' },
  { id: 'space_utilization', label: 'Space Utilization', icon: BarChart3, color: 'text-purple-400' },
];

function formatINR(num) {
  if (!num && num !== 0) return '—';
  return '₹' + Number(num).toLocaleString('en-IN');
}

export default function AIDesignPage() {
  const [selectedProject, setSelectedProject] = useState('');
  const [selectedGoals, setSelectedGoals] = useState(['cost_reduction']);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [expandedAlt, setExpandedAlt] = useState(null);

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: listProjects,
  });

  const toggleGoal = (id) => {
    setSelectedGoals((prev) =>
      prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]
    );
  };

  const handleGenerate = async () => {
    if (!selectedProject) return;
    setLoading(true);
    setError(null);

    try {
      const token = localStorage.getItem('token');
      const res = await axios.post(
        `${API}/ai-design/generate`,
        { project_id: selectedProject, optimization_goals: selectedGoals },
        {
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          timeout: 120000,
        }
      );
      setResult(res.data);
      setExpandedAlt(0);
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Generation failed');
    } finally {
      setLoading(false);
    }
  };

  const loadSample = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const res = await axios.get(`${API}/ai-design/sample`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      setResult(res.data);
      setExpandedAlt(0);
    } catch (err) {
      setError('Failed to load sample');
    } finally {
      setLoading(false);
    }
  };

  const alternatives = result?.alternatives?.alternatives || [];
  const comparison = result?.alternatives?.comparison || {};
  const svgPlans = result?.svg_plans || [];
  const recommendations = result?.alternatives?.general_recommendations || [];

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-white flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-gradient-to-br from-purple-500/20 to-indigo-500/20 border border-purple-500/20">
            <Sparkles className="w-7 h-7 text-purple-400" />
          </div>
          AI Design Generator
        </h1>
        <p className="text-surface-400 mt-1.5">Generate optimized design alternatives with cost-reduction strategies</p>
      </div>

      {/* Controls */}
      <div className="glass-card p-6 space-y-5">
        {/* Project Select */}
        <div>
          <label className="block text-sm font-medium text-surface-300 mb-1.5">Select Project</label>
          <select
            className="input-field"
            value={selectedProject}
            onChange={(e) => { setSelectedProject(e.target.value); setError(null); }}
            id="design-project-select"
          >
            <option value="">Choose a project...</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        {/* Optimization Goals */}
        <div>
          <label className="block text-sm font-medium text-surface-300 mb-2">Optimization Goals</label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {GOALS.map((goal) => {
              const Icon = goal.icon;
              const active = selectedGoals.includes(goal.id);
              return (
                <button
                  key={goal.id}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    active
                      ? 'bg-brand-500/10 border-brand-500/30 text-white'
                      : 'bg-surface-800/30 border-surface-700/50 text-surface-400 hover:border-surface-600'
                  }`}
                  onClick={() => toggleGoal(goal.id)}
                  id={`goal-${goal.id}`}
                >
                  <Icon className={`w-5 h-5 mb-1 ${active ? goal.color : 'text-surface-500'}`} />
                  <p className="text-sm font-medium">{goal.label}</p>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex gap-3">
          <button
            className="btn-primary flex-1"
            onClick={handleGenerate}
            disabled={!selectedProject || loading}
            id="generate-design-btn"
          >
            {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating alternatives...</> : <><Sparkles className="w-4 h-4" /> Generate Designs</>}
          </button>
          <button className="btn-secondary" onClick={loadSample} disabled={loading}>
            <Package className="w-4 h-4" /> Demo
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" /> {error}
          </div>
        )}
      </div>

      {/* Results */}
      {alternatives.length > 0 && (
        <div className="space-y-6">
          {/* Cost Comparison Header */}
          {comparison.original_estimated_cost && (
            <div className="glass-card p-5">
              <h3 className="text-lg font-semibold text-white mb-3">Cost Comparison Overview</h3>
              <div className="grid grid-cols-4 gap-3">
                <div className="p-3 rounded-xl bg-surface-800/50 text-center">
                  <p className="text-xs text-surface-500 mb-1">Original</p>
                  <p className="text-lg font-bold text-white">{formatINR(comparison.original_estimated_cost)}</p>
                </div>
                {comparison.alternative_costs?.map((cost, i) => (
                  <div key={i} className={`p-3 rounded-xl text-center ${
                    cost < comparison.original_estimated_cost
                      ? 'bg-emerald-500/10 border border-emerald-500/20'
                      : 'bg-amber-500/10 border border-amber-500/20'
                  }`}>
                    <p className="text-xs text-surface-500 mb-1">Alt {i + 1}</p>
                    <p className={`text-lg font-bold ${cost < comparison.original_estimated_cost ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {formatINR(cost)}
                    </p>
                    {cost < comparison.original_estimated_cost && (
                      <p className="text-xs text-emerald-400 mt-0.5">
                        -{Math.round((1 - cost / comparison.original_estimated_cost) * 100)}%
                      </p>
                    )}
                  </div>
                ))}
              </div>
              {comparison.recommendation_reason && (
                <p className="text-sm text-surface-400 mt-3 flex items-center gap-2">
                  <Lightbulb className="w-4 h-4 text-amber-400" />
                  <strong className="text-white">Recommended: Alt {comparison.recommended}</strong> — {comparison.recommendation_reason}
                </p>
              )}
            </div>
          )}

          {/* Alternative Cards */}
          {alternatives.map((alt, idx) => {
            const isExpanded = expandedAlt === idx;
            const isRecommended = comparison.recommended === alt.id;

            return (
              <div key={alt.id || idx} className={`glass-card overflow-hidden transition-all ${
                isRecommended ? 'border-emerald-500/30' : ''
              }`}>
                <button
                  className="w-full p-5 text-left flex items-center justify-between hover:bg-surface-800/20 transition-colors"
                  onClick={() => setExpandedAlt(isExpanded ? null : idx)}
                >
                  <div className="flex items-center gap-4">
                    <div className={`p-2.5 rounded-xl ${
                      isRecommended ? 'bg-emerald-500/15 border border-emerald-500/25' : 'bg-surface-800/50'
                    }`}>
                      <Building className={`w-5 h-5 ${isRecommended ? 'text-emerald-400' : 'text-surface-400'}`} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-white font-semibold">{alt.name}</h3>
                        {isRecommended && (
                          <span className="px-2 py-0.5 rounded-full text-xs bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
                            Recommended
                          </span>
                        )}
                      </div>
                      <p className="text-surface-400 text-sm mt-0.5">{alt.strategy}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    {alt.cost_reduction_percent > 0 && (
                      <span className="text-emerald-400 font-bold text-lg">-{alt.cost_reduction_percent}%</span>
                    )}
                    {isExpanded ? <ChevronUp className="w-5 h-5 text-surface-500" /> : <ChevronDown className="w-5 h-5 text-surface-500" />}
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-surface-800 p-5 space-y-5 animate-fade-in">
                    {/* Key Changes */}
                    <div>
                      <p className="text-xs text-surface-500 uppercase tracking-wider font-semibold mb-2">Key Changes</p>
                      <ul className="space-y-1.5">
                        {alt.key_changes?.map((change, i) => (
                          <li key={i} className="text-surface-300 text-sm flex items-start gap-2">
                            <span className="text-brand-400 mt-0.5">•</span> {change}
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* Metrics */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="p-3 rounded-xl bg-surface-800/50 text-center">
                        <p className="text-xs text-surface-500">Structural</p>
                        <p className="text-sm font-medium text-white">{alt.structural_impact || 'None'}</p>
                      </div>
                      <div className="p-3 rounded-xl bg-surface-800/50 text-center">
                        <p className="text-xs text-surface-500">Energy</p>
                        <p className="text-sm font-medium text-green-400">{alt.energy_efficiency || 'Same'}</p>
                      </div>
                      <div className="p-3 rounded-xl bg-surface-800/50 text-center">
                        <p className="text-xs text-surface-500">Timeline</p>
                        <p className={`text-sm font-medium ${alt.timeline_impact_days < 0 ? 'text-emerald-400' : alt.timeline_impact_days > 0 ? 'text-amber-400' : 'text-white'}`}>
                          {alt.timeline_impact_days > 0 ? `+${alt.timeline_impact_days}d` : alt.timeline_impact_days < 0 ? `${alt.timeline_impact_days}d` : 'Same'}
                        </p>
                      </div>
                      <div className="p-3 rounded-xl bg-surface-800/50 text-center">
                        <p className="text-xs text-surface-500">Sustainability</p>
                        <p className="text-sm font-medium text-green-400">{alt.sustainability_score || '—'}/10</p>
                      </div>
                    </div>

                    {/* Trade-offs */}
                    {alt.trade_offs?.length > 0 && (
                      <div className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/15">
                        <p className="text-xs text-amber-400 uppercase tracking-wider font-semibold mb-2">Trade-offs</p>
                        {alt.trade_offs.map((t, i) => (
                          <p key={i} className="text-surface-400 text-sm">• {t}</p>
                        ))}
                      </div>
                    )}

                    {/* SVG Floor Plan */}
                    {svgPlans[idx] && (
                      <div>
                        <p className="text-xs text-surface-500 uppercase tracking-wider font-semibold mb-2">Floor Plan Visualization</p>
                        <div
                          className="rounded-xl overflow-hidden border border-surface-700"
                          dangerouslySetInnerHTML={{ __html: svgPlans[idx] }}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* General Recommendations */}
          {recommendations.length > 0 && (
            <div className="glass-card p-6">
              <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                <Lightbulb className="w-5 h-5 text-amber-400" /> General Recommendations
              </h3>
              <ul className="space-y-2">
                {recommendations.map((rec, i) => (
                  <li key={i} className="text-surface-300 text-sm flex items-start gap-2">
                    <span className="text-amber-400 mt-0.5">💡</span> {rec}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

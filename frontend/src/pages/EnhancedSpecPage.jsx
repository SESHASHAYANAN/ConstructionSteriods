/**
 * EnhancedSpecPage — Structured spec generator with material details, tolerances, and standards.
 */
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  FileText, Download, Loader2, Sparkles, AlertCircle, Clock,
  ToggleLeft, ToggleRight, Beaker, Ruler, BookOpen
} from 'lucide-react';
import { listProjects } from '../lib/api';
import { downloadBlob } from '../lib/utils';
import axios from 'axios';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const DISCIPLINES = [
  'Structural Concrete',
  'Structural Steel',
  'MEP Electrical',
  'MEP Mechanical (HVAC)',
  'MEP Plumbing',
  'Fire Protection',
  'Civil / Earthworks',
  'Architectural Finishes',
  'Waterproofing & Insulation',
];

function Toggle({ label, icon: Icon, color, enabled, onToggle }) {
  return (
    <button
      className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
        enabled
          ? 'bg-brand-500/10 border-brand-500/25 text-white'
          : 'bg-surface-800/30 border-surface-700/50 text-surface-400 hover:border-surface-600'
      }`}
      onClick={onToggle}
    >
      <Icon className={`w-5 h-5 ${enabled ? color : 'text-surface-500'}`} />
      <span className="text-sm font-medium flex-1 text-left">{label}</span>
      {enabled ? <ToggleRight className="w-5 h-5 text-brand-400" /> : <ToggleLeft className="w-5 h-5 text-surface-600" />}
    </button>
  );
}

export default function EnhancedSpecPage() {
  const [selectedProject, setSelectedProject] = useState('');
  const [selectedDiscipline, setSelectedDiscipline] = useState('');
  const [loading, setLoading] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [error, setError] = useState(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [genStage, setGenStage] = useState('');

  // Enhanced options
  const [includeMaterials, setIncludeMaterials] = useState(true);
  const [includeTolerances, setIncludeTolerances] = useState(true);
  const [includeStandards, setIncludeStandards] = useState(true);

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: listProjects,
  });

  const handleGenerate = async (retryCount = 0) => {
    if (!selectedProject || !selectedDiscipline) return;
    setLoading(true);
    setGenerated(false);
    setError(null);
    setElapsedTime(0);
    setGenStage('Analyzing project context...');

    const startTime = Date.now();
    const timer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      setElapsedTime(elapsed);
      if (elapsed > 5 && elapsed <= 15) setGenStage('Gathering material specifications...');
      else if (elapsed > 15 && elapsed <= 30) setGenStage('Applying tolerance standards...');
      else if (elapsed > 30 && elapsed <= 50) setGenStage('Cross-referencing industry codes...');
      else if (elapsed > 50) setGenStage('Compiling specification document...');
    }, 1000);

    try {
      // Use enhanced spec endpoint
      const token = localStorage.getItem('token');
      const res = await axios.post(
        `${API}/spec/generate-enhanced`,
        {
          project_id: selectedProject,
          discipline: selectedDiscipline,
          include_material_details: includeMaterials,
          include_tolerances: includeTolerances,
          include_standards: includeStandards,
        },
        {
          responseType: 'blob',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          timeout: 120000,
        }
      );

      downloadBlob(new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
        `${selectedDiscipline.replace(/\s+/g, '_')}_Enhanced_Specification.docx`);
      setGenerated(true);
    } catch (err) {
      if (retryCount < 1) {
        setGenStage('First attempt failed, retrying...');
        clearInterval(timer);
        setTimeout(() => handleGenerate(retryCount + 1), 2000);
        return;
      }
      setError(err.response?.data?.detail || err.message || 'Generation failed');
    } finally {
      clearInterval(timer);
      setLoading(false);
      setGenStage('');
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8 animate-fade-in">
      <div>
        <h1 className="text-3xl font-bold text-white">Enhanced Spec Generator</h1>
        <p className="text-surface-400 mt-1">Generate structured specifications with material details, tolerances & standards</p>
      </div>

      <div className="glass-card p-8 space-y-6">
        {/* Icon */}
        <div className="flex justify-center">
          <div className="p-4 rounded-2xl bg-gradient-to-br from-brand-500/20 to-purple-500/20 border border-brand-500/20">
            <Sparkles className="w-10 h-10 text-brand-400" />
          </div>
        </div>

        {/* Project Select */}
        <div>
          <label htmlFor="espec-project" className="block text-sm font-medium text-surface-300 mb-1.5">Select Project</label>
          <select
            id="espec-project"
            className="input-field"
            value={selectedProject}
            onChange={(e) => { setSelectedProject(e.target.value); setError(null); }}
          >
            <option value="">Choose a project...</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        {/* Discipline Select */}
        <div>
          <label htmlFor="espec-discipline" className="block text-sm font-medium text-surface-300 mb-1.5">Select Discipline</label>
          <select
            id="espec-discipline"
            className="input-field"
            value={selectedDiscipline}
            onChange={(e) => { setSelectedDiscipline(e.target.value); setError(null); }}
          >
            <option value="">Choose a discipline...</option>
            {DISCIPLINES.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>

        {/* Enhanced Options */}
        <div className="space-y-2">
          <p className="text-xs text-surface-500 uppercase tracking-wider font-semibold">Enhanced Output Options</p>
          <Toggle
            label="Material Details (grades, ASTM refs, properties)"
            icon={Beaker}
            color="text-orange-400"
            enabled={includeMaterials}
            onToggle={() => setIncludeMaterials(!includeMaterials)}
          />
          <Toggle
            label="Tolerances (dimensional, surface, alignment)"
            icon={Ruler}
            color="text-blue-400"
            enabled={includeTolerances}
            onToggle={() => setIncludeTolerances(!includeTolerances)}
          />
          <Toggle
            label="Industry Standards (ACI, AISC, ASHRAE refs)"
            icon={BookOpen}
            color="text-emerald-400"
            enabled={includeStandards}
            onToggle={() => setIncludeStandards(!includeStandards)}
          />
        </div>

        {/* Generate Button */}
        <button
          className="btn-primary w-full"
          onClick={() => handleGenerate()}
          disabled={!selectedProject || !selectedDiscipline || loading}
          id="generate-enhanced-spec-btn"
        >
          {loading ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Generating Enhanced Spec...</>
          ) : (
            <><FileText className="w-4 h-4" /> Generate Enhanced Specification</>
          )}
        </button>

        {/* Loading Timer */}
        {loading && (
          <div className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/15 text-amber-300 text-sm flex items-center gap-3">
            <Clock className="w-4 h-4 flex-shrink-0 animate-pulse" />
            <div>
              <p className="font-medium">{genStage || 'Generating...'}</p>
              <p className="text-amber-400/70 text-xs mt-0.5">Elapsed: {elapsedTime}s — Enhanced specs typically take 30-90 seconds</p>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm space-y-2">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span className="font-medium">Generation Failed</span>
            </div>
            <p className="text-red-300/80 text-xs">{error}</p>
            <button className="text-xs text-red-400 hover:text-red-300 underline" onClick={() => handleGenerate()}>Try again</button>
          </div>
        )}

        {/* Success */}
        {generated && (
          <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm flex items-center gap-2">
            <Download className="w-4 h-4" />
            Enhanced specification generated and downloaded successfully!
          </div>
        )}
      </div>
    </div>
  );
}

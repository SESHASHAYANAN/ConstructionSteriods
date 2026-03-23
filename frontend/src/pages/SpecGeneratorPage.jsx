import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, Download, Loader2, Sparkles, AlertCircle, Clock } from 'lucide-react';
import { listProjects, generateSpec } from '../lib/api';
import { downloadBlob } from '../lib/utils';

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

export default function SpecGeneratorPage() {
  const [selectedProject, setSelectedProject] = useState('');
  const [selectedDiscipline, setSelectedDiscipline] = useState('');
  const [loading, setLoading] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [error, setError] = useState(null);
  const [elapsedTime, setElapsedTime] = useState(0);

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: listProjects,
  });

  const [genStage, setGenStage] = useState('');

  const handleGenerate = async (retryCount = 0) => {
    if (!selectedProject || !selectedDiscipline) return;
    setLoading(true);
    setGenerated(false);
    setError(null);
    setElapsedTime(0);
    setGenStage('Analyzing project data...');

    // Start a timer to show elapsed time with progressive stages
    const startTime = Date.now();
    const timer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      setElapsedTime(elapsed);
      if (elapsed > 5 && elapsed <= 20) setGenStage('Processing with AI engine...');
      else if (elapsed > 20 && elapsed <= 45) setGenStage('Generating detailed specification...');
      else if (elapsed > 45) setGenStage('Converting to DOCX format...');
    }, 1000);

    try {
      const blob = await generateSpec(selectedProject, selectedDiscipline);
      downloadBlob(blob, `${selectedDiscipline.replace(/\s+/g, '_')}_Specification.docx`);
      setGenerated(true);
    } catch (err) {
      // Error handled via error state below
      // Auto-retry once on failure
      if (retryCount < 1) {
        setGenStage('First attempt failed, retrying automatically...');
        clearInterval(timer);
        setTimeout(() => handleGenerate(retryCount + 1), 2000);
        return;
      }
      setError(err.message || 'An unexpected error occurred. Please try again.');
    } finally {
      clearInterval(timer);
      setLoading(false);
      setGenStage('');
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8 animate-fade-in">
      <div>
        <h1 className="text-3xl font-bold text-white">Spec Generator</h1>
        <p className="text-surface-400 mt-1">Generate comprehensive specification documents using AI</p>
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
          <label htmlFor="spec-project" className="block text-sm font-medium text-surface-300 mb-1.5">
            Select Project
          </label>
          <select
            id="spec-project"
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
          <label htmlFor="spec-discipline" className="block text-sm font-medium text-surface-300 mb-1.5">
            Select Discipline
          </label>
          <select
            id="spec-discipline"
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

        {/* Generate Button */}
        <button
          className="btn-primary w-full"
          onClick={handleGenerate}
          disabled={!selectedProject || !selectedDiscipline || loading}
          id="generate-spec-btn"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" /> Generating...
            </>
          ) : (
            <><FileText className="w-4 h-4" /> Generate Specification</>
          )}
        </button>

        {/* Loading Timer */}
        {loading && (
          <div className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/15 text-amber-300 text-sm flex items-center gap-3">
            <Clock className="w-4 h-4 flex-shrink-0 animate-pulse" />
            <div>
              <p className="font-medium">{genStage || 'Generating specification...'}</p>
              <p className="text-amber-400/70 text-xs mt-0.5">
                Elapsed: {elapsedTime}s — This typically takes 30-60 seconds
              </p>
            </div>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm space-y-2">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span className="font-medium">Generation Failed</span>
            </div>
            <p className="text-red-300/80 text-xs">{error}</p>
            <button
              className="text-xs text-red-400 hover:text-red-300 underline underline-offset-2"
              onClick={handleGenerate}
            >
              Try again
            </button>
          </div>
        )}

        {/* Success */}
        {generated && (
          <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm flex items-center gap-2">
            <Download className="w-4 h-4" />
            Specification document generated and downloaded successfully!
          </div>
        )}
      </div>
    </div>
  );
}

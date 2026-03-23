import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Settings, Plus, X, Save, Loader2, BookOpen, CheckSquare } from 'lucide-react';
import { listProjects, getProjectSettings, updateProjectSettings } from '../lib/api';

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const [selectedProject, setSelectedProject] = useState('');
  const [rules, setRules] = useState([]);
  const [codes, setCodes] = useState([]);
  const [newRule, setNewRule] = useState({ category: '', description: '', severity: 'Major' });
  const [newCode, setNewCode] = useState('');
  const [saved, setSaved] = useState(false);

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: listProjects,
  });

  const { isLoading: settingsLoading } = useQuery({
    queryKey: ['settings', selectedProject],
    queryFn: () => getProjectSettings(selectedProject),
    enabled: !!selectedProject,
    onSuccess: (data) => {
      setRules(data.checklist_rules || []);
      setCodes(data.building_codes || []);
    },
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      updateProjectSettings(selectedProject, {
        checklist_rules: rules,
        building_codes: codes,
      }),
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      queryClient.invalidateQueries({ queryKey: ['settings', selectedProject] });
    },
  });

  const addRule = () => {
    if (newRule.category && newRule.description) {
      setRules((prev) => [...prev, { ...newRule, id: Date.now().toString(36) }]);
      setNewRule({ category: '', description: '', severity: 'Major' });
    }
  };

  const removeRule = (idx) => setRules((prev) => prev.filter((_, i) => i !== idx));

  const addCode = () => {
    if (newCode.trim()) {
      setCodes((prev) => [...prev, newCode.trim()]);
      setNewCode('');
    }
  };

  const removeCode = (idx) => setCodes((prev) => prev.filter((_, i) => i !== idx));

  return (
    <div className="max-w-3xl mx-auto space-y-8 animate-fade-in">
      <div>
        <h1 className="text-3xl font-bold text-white flex items-center gap-3">
          <Settings className="w-8 h-8 text-brand-400" /> Settings
        </h1>
        <p className="text-surface-400 mt-1">Configure checklist rules and building codes per project</p>
      </div>

      {/* Project Selector */}
      <div className="glass-card p-6">
        <label htmlFor="settings-project" className="block text-sm font-medium text-surface-300 mb-1.5">
          Select Project
        </label>
        <select
          id="settings-project"
          className="input-field"
          value={selectedProject}
          onChange={(e) => { setSelectedProject(e.target.value); setSaved(false); }}
        >
          <option value="">Choose a project...</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {selectedProject && (
        <>
          {/* Building Codes */}
          <div className="glass-card p-6 space-y-4">
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-brand-400" /> Building Codes
            </h3>
            <div className="flex gap-2">
              <input
                className="input-field flex-1"
                placeholder="e.g. ACI 318-19, AISC 360-22, IBC 2021"
                value={newCode}
                onChange={(e) => setNewCode(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addCode())}
              />
              <button className="btn-secondary" onClick={addCode}><Plus className="w-4 h-4" /> Add</button>
            </div>
            {codes.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {codes.map((code, i) => (
                  <span key={i} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-500/10 text-brand-400 text-sm font-medium border border-brand-500/20">
                    {code}
                    <button onClick={() => removeCode(i)} className="hover:text-red-400"><X className="w-3 h-3" /></button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Checklist Rules */}
          <div className="glass-card p-6 space-y-4">
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              <CheckSquare className="w-5 h-5 text-brand-400" /> Checklist Rules
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <input
                className="input-field"
                placeholder="Category (e.g. Title Block)"
                value={newRule.category}
                onChange={(e) => setNewRule((r) => ({ ...r, category: e.target.value }))}
              />
              <input
                className="input-field"
                placeholder="Description"
                value={newRule.description}
                onChange={(e) => setNewRule((r) => ({ ...r, description: e.target.value }))}
              />
              <div className="flex gap-2">
                <select
                  className="input-field flex-1"
                  value={newRule.severity}
                  onChange={(e) => setNewRule((r) => ({ ...r, severity: e.target.value }))}
                >
                  <option value="Critical">Critical</option>
                  <option value="Major">Major</option>
                  <option value="Minor">Minor</option>
                </select>
                <button className="btn-secondary" onClick={addRule}><Plus className="w-4 h-4" /></button>
              </div>
            </div>

            {rules.length > 0 && (
              <div className="space-y-2">
                {rules.map((rule, i) => (
                  <div key={rule.id || i} className="flex items-center gap-3 p-3 rounded-xl bg-surface-800/50 border border-surface-700/50">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                      rule.severity === 'Critical' ? 'bg-red-500/15 text-red-400' :
                      rule.severity === 'Major' ? 'bg-amber-500/15 text-amber-400' :
                      'bg-blue-500/15 text-blue-400'
                    }`}>
                      {rule.severity}
                    </span>
                    <span className="text-surface-300 text-sm font-medium">{rule.category}</span>
                    <span className="text-surface-400 text-sm flex-1">{rule.description}</span>
                    <button onClick={() => removeRule(i)} className="text-surface-500 hover:text-red-400">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Save */}
          <div className="flex items-center justify-end gap-3">
            {saved && (
              <span className="text-emerald-400 text-sm font-medium animate-fade-in">Settings saved!</span>
            )}
            <button
              className="btn-primary"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              id="save-settings-btn"
            >
              {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save Settings
            </button>
          </div>
        </>
      )}
    </div>
  );
}

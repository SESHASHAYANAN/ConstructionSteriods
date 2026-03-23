import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import {
  Plus, FolderOpen, AlertTriangle, Activity, FileText,
  TrendingUp, Loader2, X
} from 'lucide-react';
import { listProjects, createProject } from '../lib/api';
import { useProjectStore, useUIStore } from '../stores';
import { healthColor } from '../lib/utils';

export default function DashboardPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setActiveProject = useProjectStore((s) => s.setActiveProject);
  const [showCreate, setShowCreate] = useState(false);
  const [newProject, setNewProject] = useState({ name: '', description: '', building_codes: [] });
  const [codeInput, setCodeInput] = useState('');

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: listProjects,
  });

  const createMutation = useMutation({
    mutationFn: createProject,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setShowCreate(false);
      setNewProject({ name: '', description: '', building_codes: [] });
    },
  });

  const handleOpenProject = (project) => {
    setActiveProject(project.id);
    navigate(`/project/${project.id}`);
  };

  // Chart data: aggregate severity counts
  const severityCounts = projects.reduce(
    (acc, p) => {
      // Estimate from health score
      const lost = 100 - p.health_score;
      acc.Critical += Math.floor(lost / 10);
      acc.Major += Math.floor((lost % 10) / 5);
      acc.Minor += p.issue_count - Math.floor(lost / 10) - Math.floor((lost % 10) / 5);
      return acc;
    },
    { Critical: 0, Major: 0, Minor: 0 }
  );
  const chartData = [
    { name: 'Critical', value: Math.max(0, severityCounts.Critical), fill: '#ef4444' },
    { name: 'Major', value: Math.max(0, severityCounts.Major), fill: '#f59e0b' },
    { name: 'Minor', value: Math.max(0, severityCounts.Minor), fill: '#3b82f6' },
  ];

  const totalIssues = projects.reduce((s, p) => s + p.issue_count, 0);
  const avgHealth = projects.length
    ? (projects.reduce((s, p) => s + p.health_score, 0) / projects.length).toFixed(1)
    : 100;

  const handleAddCode = () => {
    if (codeInput.trim()) {
      setNewProject((p) => ({ ...p, building_codes: [...p.building_codes, codeInput.trim()] }));
      setCodeInput('');
    }
  };

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Dashboard</h1>
          <p className="text-surface-400 mt-1">Overview of all QA/QC projects</p>
        </div>
        <button className="btn-primary" onClick={() => setShowCreate(true)} id="create-project-btn">
          <Plus className="w-4 h-4" /> New Project
        </button>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Projects', value: projects.length, icon: FolderOpen, color: 'text-brand-400' },
          { label: 'Total Issues', value: totalIssues, icon: AlertTriangle, color: 'text-amber-400' },
          { label: 'Avg Health Score', value: `${avgHealth}%`, icon: Activity, color: healthColor(Number(avgHealth)) },
          { label: 'Total Files', value: projects.reduce((s, p) => s + p.file_count, 0), icon: FileText, color: 'text-emerald-400' },
        ].map((stat) => (
          <div key={stat.label} className="glass-card p-5">
            <div className="flex items-center gap-3">
              <div className={`p-2.5 rounded-xl bg-surface-800 ${stat.color}`}>
                <stat.icon className="w-5 h-5" />
              </div>
              <div>
                <p className="text-surface-400 text-xs font-medium uppercase tracking-wider">{stat.label}</p>
                <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Chart + Projects */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Chart */}
        <div className="glass-card p-6">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-brand-400" /> Issues by Severity
          </h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData}>
              <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '12px', color: '#f1f5f9' }}
                cursor={{ fill: 'rgba(45,114,255,0.1)' }}
              />
              <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                {chartData.map((entry, i) => (
                  <Cell key={i} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Project List */}
        <div className="lg:col-span-2 space-y-3">
          <h3 className="text-lg font-semibold text-white">Projects</h3>
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-8 h-8 text-brand-400 animate-spin" />
            </div>
          ) : projects.length === 0 ? (
            <div className="glass-card p-12 text-center">
              <FolderOpen className="w-12 h-12 text-surface-600 mx-auto mb-4" />
              <p className="text-surface-400">No projects yet. Create your first project to get started.</p>
            </div>
          ) : (
            projects.map((project) => (
              <div
                key={project.id}
                className="glass-card-hover p-5 cursor-pointer"
                onClick={() => handleOpenProject(project)}
                id={`project-card-${project.id}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <h4 className="text-white font-semibold truncate">{project.name}</h4>
                    <p className="text-surface-400 text-sm mt-0.5 truncate">{project.description || 'No description'}</p>
                    <div className="flex items-center gap-4 mt-2">
                      <span className="text-xs text-surface-500">{project.file_count} files</span>
                      <span className="text-xs text-surface-500">{project.issue_count} issues</span>
                      <span className={`text-xs font-medium ${
                        project.review_status === 'Complete' ? 'text-emerald-400' :
                        project.review_status === 'In Progress' ? 'text-amber-400' : 'text-surface-500'
                      }`}>
                        {project.review_status}
                      </span>
                    </div>
                  </div>
                  <div className="text-right ml-4">
                    <p className={`text-2xl font-bold ${healthColor(project.health_score)}`}>
                      {project.health_score}
                    </p>
                    <p className="text-xs text-surface-500">Health</p>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Create Project Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="glass-card p-6 w-full max-w-lg animate-slide-up" id="create-project-modal">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-xl font-bold text-white">New Project</h3>
              <button onClick={() => setShowCreate(false)} className="btn-ghost p-1.5">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label htmlFor="project-name" className="block text-sm font-medium text-surface-300 mb-1.5">Project Name</label>
                <input
                  id="project-name"
                  className="input-field"
                  placeholder="e.g. Tower B - Structural Review"
                  value={newProject.name}
                  onChange={(e) => setNewProject((p) => ({ ...p, name: e.target.value }))}
                />
              </div>
              <div>
                <label htmlFor="project-desc" className="block text-sm font-medium text-surface-300 mb-1.5">Description</label>
                <textarea
                  id="project-desc"
                  className="input-field min-h-[80px] resize-none"
                  placeholder="Brief project description..."
                  value={newProject.description}
                  onChange={(e) => setNewProject((p) => ({ ...p, description: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-surface-300 mb-1.5">Building Codes</label>
                <div className="flex gap-2">
                  <input
                    className="input-field flex-1"
                    placeholder="e.g. ACI 318-19"
                    value={codeInput}
                    onChange={(e) => setCodeInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddCode())}
                  />
                  <button type="button" className="btn-secondary" onClick={handleAddCode}>Add</button>
                </div>
                {newProject.building_codes.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {newProject.building_codes.map((code, i) => (
                      <span key={i} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-brand-500/10 text-brand-400 text-xs font-medium border border-brand-500/20">
                        {code}
                        <button onClick={() => setNewProject((p) => ({ ...p, building_codes: p.building_codes.filter((_, j) => j !== i) }))} className="hover:text-red-400">
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button className="btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
              <button
                className="btn-primary"
                disabled={!newProject.name.trim() || createMutation.isPending}
                onClick={() => createMutation.mutate(newProject)}
                id="submit-project-btn"
              >
                {createMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Create Project
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

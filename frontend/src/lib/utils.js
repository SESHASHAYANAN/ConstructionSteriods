import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export function severityColor(severity) {
  switch (severity) {
    case 'Critical': return 'badge-critical';
    case 'Major': return 'badge-major';
    case 'Minor': return 'badge-minor';
    default: return 'badge-minor';
  }
}

export function statusColor(status) {
  switch (status) {
    case 'Open': return 'text-amber-400';
    case 'Accepted': return 'text-green-400';
    case 'Rejected': return 'text-red-400';
    case 'Escalated': return 'text-purple-400';
    case 'Fixed': return 'text-emerald-400';
    default: return 'text-surface-400';
  }
}

export function healthColor(score) {
  if (score >= 80) return 'text-emerald-400';
  if (score >= 50) return 'text-amber-400';
  return 'text-red-400';
}

export function downloadBlob(blob, filename) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

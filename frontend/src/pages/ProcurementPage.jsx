import React, { useState } from 'react';
import {
  ShoppingCart, Plus, Trash2, Loader2, TrendingDown, DollarSign,
  Truck, AlertTriangle, ChevronDown, BarChart3, Star, Package
} from 'lucide-react';
import api from '../lib/api';

const REGIONS = ['General','North America','Europe','Middle East','South Asia','Southeast Asia','East Asia','Africa','South America','Oceania'];
const BUDGET_TIERS = ['Budget', 'Mid-Range', 'Premium'];
const UNITS = ['MT','Bags','Nos','Cum','Sqm','Rmt','Kg','Litres','Sets'];
const EMPTY_ITEM = { name: '', quantity: '', unit: 'MT', spec: '' };
const TABS = [
  { key: 'suppliers', label: 'Suppliers', icon: Truck },
  { key: 'costs', label: 'Cost Analysis', icon: DollarSign },
  { key: 'savings', label: 'Savings', icon: TrendingDown },
  { key: 'risks', label: 'Risks', icon: AlertTriangle },
];

function SupplierTab({ data }) {
  if (!data?.length) return <p className="text-surface-500 p-6">No supplier data available.</p>;
  return (
    <div className="space-y-4">
      {data.map((cat, ci) => (
        <div key={ci} className="glass-card p-6">
          <h3 className="text-white font-semibold text-lg mb-4">{cat.category}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {cat.recommendations?.map((sup, si) => (
              <div key={si} className="p-4 rounded-xl bg-surface-800/60 border border-surface-700/50 hover:border-violet-500/30 transition-all">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-white font-semibold">{sup.name}</h4>
                  <div className="flex items-center gap-1 text-amber-400">
                    <Star className="w-4 h-4 fill-current" /><span className="text-sm font-semibold">{sup.quality_rating}</span>
                  </div>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-surface-400">Price</span><span className="text-emerald-400 font-medium">{sup.price_range}</span></div>
                  <div className="flex justify-between"><span className="text-surface-400">Lead Time</span><span className="text-surface-200">{sup.lead_time}</span></div>
                  {sup.moq && <div className="flex justify-between"><span className="text-surface-400">MOQ</span><span className="text-surface-200">{sup.moq}</span></div>}
                </div>
                {sup.advantages?.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-surface-700/50">
                    <ul className="text-xs text-emerald-400/80 space-y-0.5">
                      {sup.advantages.slice(0,3).map((a,i) => <li key={i}>✓ {a}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function CostTab({ data }) {
  if (!data?.items?.length) return <p className="text-surface-500 p-6">No cost data available.</p>;
  return (
    <div className="glass-card p-6 overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="text-surface-400 border-b border-surface-700/50">
          <th className="text-left py-3 px-2">Item</th><th className="text-right py-3 px-2">Qty</th>
          <th className="text-right py-3 px-2">Budget</th><th className="text-right py-3 px-2">Mid</th><th className="text-right py-3 px-2">Premium</th>
        </tr></thead>
        <tbody>{data.items.map((it,i) => (
          <tr key={i} className="border-b border-surface-800/50 hover:bg-surface-800/30">
            <td className="py-3 px-2 text-surface-200 font-medium">{it.name}</td>
            <td className="py-3 px-2 text-right text-surface-400">{it.quantity} {it.unit}</td>
            <td className="py-3 px-2 text-right text-emerald-400">{it.budget_total||it.budget_price}</td>
            <td className="py-3 px-2 text-right text-violet-400">{it.mid_total||it.mid_price}</td>
            <td className="py-3 px-2 text-right text-amber-400">{it.premium_total||it.premium_price}</td>
          </tr>
        ))}</tbody>
        <tfoot><tr className="font-bold text-white border-t-2 border-surface-600">
          <td className="py-3 px-2" colSpan={2}>Totals</td>
          <td className="py-3 px-2 text-right text-emerald-400">{data.total_budget}</td>
          <td className="py-3 px-2 text-right text-violet-400">{data.total_mid}</td>
          <td className="py-3 px-2 text-right text-amber-400">{data.total_premium}</td>
        </tr></tfoot>
      </table>
    </div>
  );
}

function SavingsTab({ data }) {
  if (!data?.length) return <p className="text-surface-500 p-6">No savings data available.</p>;
  return (
    <div className="space-y-4">{data.map((s,i) => (
      <div key={i} className="glass-card p-6 border-l-4 border-emerald-500">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-white font-semibold">{s.strategy}</h4>
          <span className="px-3 py-1 rounded-full bg-emerald-500/15 text-emerald-400 text-sm font-bold border border-emerald-500/25">{s.potential_savings}</span>
        </div>
        <p className="text-surface-300 text-sm">{s.description}</p>
        <div className="flex gap-4 mt-3 text-xs text-surface-500">
          <span>Effort: <span className="text-surface-300">{s.effort_level}</span></span>
          <span>Timeline: <span className="text-surface-300">{s.timeline}</span></span>
        </div>
      </div>
    ))}</div>
  );
}

function RiskTab({ data }) {
  if (!data?.length) return <p className="text-surface-500 p-6">No risk data available.</p>;
  return (
    <div className="space-y-3">{data.map((r,i) => (
      <div key={i} className="glass-card p-5">
        <div className="flex items-center gap-3 mb-2">
          <span className={r.risk_level==='High'?'badge-critical':r.risk_level==='Medium'?'badge-major':'badge-minor'}>{r.risk_level}</span>
          <span className="text-white font-semibold text-sm">{r.item}</span>
          <span className="text-surface-500 text-xs">({r.risk_type})</span>
        </div>
        <p className="text-surface-300 text-sm">{r.description}</p>
        {r.mitigation && <p className="text-surface-400 text-xs mt-2"><span className="text-teal-400 font-medium">Mitigation: </span>{r.mitigation}</p>}
      </div>
    ))}</div>
  );
}

export default function ProcurementPage() {
  const [items, setItems] = useState([{ ...EMPTY_ITEM }]);
  const [region, setRegion] = useState('General');
  const [budget, setBudget] = useState('Mid-Range');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('suppliers');

  const updateItem = (idx, field, value) => setItems(p => p.map((it,i) => i===idx ? {...it,[field]:value} : it));
  const addItem = () => setItems(p => [...p, { ...EMPTY_ITEM }]);
  const removeItem = (idx) => { if (items.length > 1) setItems(p => p.filter((_,i) => i !== idx)); };

  const handleAnalyze = async () => {
    const valid = items.filter(it => it.name.trim());
    if (!valid.length) return setError('Add at least one material item.');
    setLoading(true); setError(''); setResult(null);
    try {
      const res = await api.post('/procurement/analyze', { items: valid, region, budget_preference: budget }, { timeout: 120000 });
      setResult(res.data);
    } catch (err) { setError(err.response?.data?.detail || err.message || 'Analysis failed.'); }
    finally { setLoading(false); }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <div className="flex items-center gap-4">
        <div className="p-3 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 shadow-lg shadow-violet-500/20">
          <ShoppingCart className="w-7 h-7 text-white" />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Smart Procurement</h1>
          <p className="text-surface-400 mt-1">AI-powered pricing engine — find the best suppliers at optimal costs</p>
        </div>
      </div>

      <div className="glass-card p-6">
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2"><Package className="w-5 h-5 text-violet-400" /> Material Requirements</h2>
        <div className="space-y-3">
          <div className="grid grid-cols-12 gap-3 text-xs font-semibold text-surface-400 uppercase tracking-wider px-1">
            <div className="col-span-4">Material</div><div className="col-span-2">Quantity</div><div className="col-span-2">Unit</div><div className="col-span-3">Spec</div><div className="col-span-1"></div>
          </div>
          {items.map((item, idx) => (
            <div key={idx} className="grid grid-cols-12 gap-3 items-center">
              <input className="col-span-4 input-field" placeholder="e.g., Portland Cement OPC 53" value={item.name} onChange={e => updateItem(idx,'name',e.target.value)} />
              <input className="col-span-2 input-field" placeholder="500" value={item.quantity} onChange={e => updateItem(idx,'quantity',e.target.value)} />
              <div className="col-span-2 relative">
                <select className="input-field appearance-none pr-8" value={item.unit} onChange={e => updateItem(idx,'unit',e.target.value)}>
                  {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-500 pointer-events-none" />
              </div>
              <input className="col-span-3 input-field" placeholder="IS 269, Grade 53" value={item.spec} onChange={e => updateItem(idx,'spec',e.target.value)} />
              <button onClick={() => removeItem(idx)} className="col-span-1 p-2 rounded-lg text-surface-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
          <button onClick={addItem} className="btn-ghost text-violet-400 hover:text-violet-300"><Plus className="w-4 h-4" /> Add Item</button>
        </div>
        <div className="flex flex-wrap gap-4 mt-6 items-end">
          <div className="flex-1 min-w-[180px]">
            <label className="block text-sm font-medium text-surface-300 mb-2">Region</label>
            <div className="relative">
              <select value={region} onChange={e => setRegion(e.target.value)} className="input-field appearance-none pr-8" id="procurement-region">
                {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-500 pointer-events-none" />
            </div>
          </div>
          <div className="flex-1 min-w-[180px]">
            <label className="block text-sm font-medium text-surface-300 mb-2">Budget</label>
            <div className="flex gap-2">
              {BUDGET_TIERS.map(t => (
                <button key={t} onClick={() => setBudget(t)} className={`flex-1 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${budget===t ? 'bg-violet-600/20 text-violet-400 border border-violet-500/30' : 'bg-surface-800 text-surface-400 border border-surface-600/50 hover:text-surface-200'}`}>{t}</button>
              ))}
            </div>
          </div>
          <button onClick={handleAnalyze} disabled={loading} className="btn-primary px-8" id="analyze-procurement-btn">
            {loading ? <><Loader2 className="w-5 h-5 animate-spin" /> Analyzing...</> : <><BarChart3 className="w-5 h-5" /> Analyze</>}
          </button>
        </div>
        {error && <div className="mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/25 text-red-400 text-sm">{error}</div>}
      </div>

      {loading && (
        <div className="glass-card p-12 text-center">
          <Loader2 className="w-16 h-16 text-violet-400 mx-auto mb-4 animate-spin" />
          <p className="text-surface-300 text-lg font-medium">Analyzing Procurement...</p>
        </div>
      )}

      {result && (
        <div className="space-y-6">
          {result.executive_summary && (
            <div className="glass-card p-6 border-l-4 border-violet-500">
              <h3 className="text-sm font-semibold text-surface-400 uppercase tracking-wider mb-2">Executive Summary</h3>
              <p className="text-surface-200">{result.executive_summary}</p>
              {result.total_estimated_budget && (
                <div className="mt-4 p-4 rounded-xl bg-gradient-to-r from-violet-500/10 to-purple-500/10 border border-violet-500/20">
                  <p className="text-surface-400 text-sm">Estimated Budget</p>
                  <p className="text-2xl font-bold text-white mt-1">{result.total_estimated_budget}</p>
                </div>
              )}
            </div>
          )}
          <div className="flex gap-2 p-1 bg-surface-800/50 rounded-xl">
            {TABS.map(({key,label,icon:Icon}) => (
              <button key={key} onClick={() => setActiveTab(key)} className={`${activeTab===key?'tab-btn-active':'tab-btn'} flex items-center gap-2 flex-1 justify-center`}>
                <Icon className="w-4 h-4" /> {label}
              </button>
            ))}
          </div>
          {activeTab==='suppliers' && <SupplierTab data={result.suppliers} />}
          {activeTab==='costs' && <CostTab data={result.cost_analysis} />}
          {activeTab==='savings' && <SavingsTab data={result.savings_opportunities} />}
          {activeTab==='risks' && <RiskTab data={result.risk_assessment} />}
        </div>
      )}
    </div>
  );
}

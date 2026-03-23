import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { LogIn, Shield, Loader2 } from 'lucide-react';
import { login, getMe } from '../lib/api';
import { useAuthStore } from '../stores';

const loginSchema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});

export default function LoginPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const setUser = useAuthStore((s) => s.setUser);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: 'admin@constructai.com', password: 'admin123' },
  });

  const onSubmit = async (data) => {
    setLoading(true);
    setError('');
    try {
      const { access_token } = await login(data.email, data.password);
      setAuth(null, access_token);
      const user = await getMe();
      setUser(user);
      navigate('/');
    } catch {
      setError('Invalid email or password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden">
      {/* Animated background */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-1/2 -left-1/2 w-full h-full bg-gradient-to-br from-brand-600/20 to-transparent rounded-full blur-3xl animate-pulse-slow" />
        <div className="absolute -bottom-1/2 -right-1/2 w-full h-full bg-gradient-to-tl from-brand-500/10 to-transparent rounded-full blur-3xl animate-pulse-slow" style={{ animationDelay: '1.5s' }} />
      </div>

      <div className="glass-card p-8 w-full max-w-md animate-fade-in relative z-10">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 shadow-lg shadow-brand-500/30 mb-4">
            <Shield className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">ConstructAI</h1>
          <p className="text-surface-400 text-sm mt-1">AI-Powered QA/QC Platform</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" id="login-form">
          <div>
            <label htmlFor="login-email" className="block text-sm font-medium text-surface-300 mb-1.5">Email</label>
            <input
              id="login-email"
              type="email"
              className="input-field"
              placeholder="admin@constructai.com"
              {...register('email')}
            />
            {errors.email && <p className="text-red-400 text-xs mt-1">{errors.email.message}</p>}
          </div>

          <div>
            <label htmlFor="login-password" className="block text-sm font-medium text-surface-300 mb-1.5">Password</label>
            <input
              id="login-password"
              type="password"
              className="input-field"
              placeholder="••••••••"
              {...register('password')}
            />
            {errors.password && <p className="text-red-400 text-xs mt-1">{errors.password.message}</p>}
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/25 text-red-400 text-sm">
              {error}
            </div>
          )}

          <button type="submit" disabled={loading} className="btn-primary w-full" id="login-submit">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p className="text-surface-500 text-xs text-center mt-6">
          Demo: admin@constructai.com / admin123
        </p>
      </div>
    </div>
  );
}

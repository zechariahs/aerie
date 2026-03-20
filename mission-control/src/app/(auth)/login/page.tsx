// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

'use client'; // Needs form state and multi-step interaction

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';

type LoginStep = 'password' | 'totp';

interface PasswordStepState {
  password: string;
  error: string;
  loading: boolean;
}

interface TotpStepState {
  code: string;
  tempToken: string;
  error: string;
  loading: boolean;
}

export default function LoginPage(): React.JSX.Element {
  const router = useRouter();
  const [step, setStep] = useState<LoginStep>('password');

  const [pwState, setPwState] = useState<PasswordStepState>({
    password: '',
    error: '',
    loading: false,
  });

  const [totpState, setTotpState] = useState<TotpStepState>({
    code: '',
    tempToken: '',
    error: '',
    loading: false,
  });

  async function handlePasswordSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setPwState((s) => ({ ...s, loading: true, error: '' }));

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: 'password', password: pwState.password }),
      });

      const body = await res.json() as { nextStep?: string; tempToken?: string; error?: string };

      if (!res.ok) {
        setPwState((s) => ({ ...s, loading: false, error: body.error ?? 'Login failed' }));
        return;
      }

      setTotpState((s) => ({ ...s, tempToken: body.tempToken ?? '' }));
      setStep('totp');
      setPwState((s) => ({ ...s, loading: false, password: '' }));
    } catch {
      setPwState((s) => ({ ...s, loading: false, error: 'Network error — try again' }));
    }
  }

  async function handleTotpSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setTotpState((s) => ({ ...s, loading: true, error: '' }));

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          step: 'totp',
          tempToken: totpState.tempToken,
          totp: totpState.code,
        }),
      });

      const body = await res.json() as { error?: string };

      if (!res.ok) {
        setTotpState((s) => ({ ...s, loading: false, error: body.error ?? 'Invalid code' }));
        return;
      }

      router.replace('/');
    } catch {
      setTotpState((s) => ({ ...s, loading: false, error: 'Network error — try again' }));
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0f]">
      <div className="w-full max-w-sm border border-[#1e1e2e] rounded-lg p-8 bg-[#12121a]">
        <h1 className="text-lg font-semibold text-white mb-1">Mission Control</h1>
        <p className="text-sm text-[#6b7280] mb-6">WintermuteTuring Operations</p>

        {step === 'password' && (
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <div>
              <label htmlFor="password" className="block text-xs text-[#6b7280] mb-1 uppercase tracking-wider">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={pwState.password}
                onChange={(e) => setPwState((s) => ({ ...s, password: e.target.value }))}
                className="w-full bg-[#0a0a0f] border border-[#1e1e2e] rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[#6366f1]"
              />
            </div>

            {pwState.error && (
              <p className="text-xs text-red-400">{pwState.error}</p>
            )}

            <button
              type="submit"
              disabled={pwState.loading}
              className="w-full bg-[#6366f1] hover:bg-[#4f52c9] text-white text-sm font-medium py-2 rounded transition-colors disabled:opacity-50"
            >
              {pwState.loading ? 'Verifying…' : 'Continue'}
            </button>
          </form>
        )}

        {step === 'totp' && (
          <form onSubmit={handleTotpSubmit} className="space-y-4">
            <div>
              <label htmlFor="totp" className="block text-xs text-[#6b7280] mb-1 uppercase tracking-wider">
                Authenticator Code
              </label>
              <input
                id="totp"
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                autoComplete="one-time-code"
                maxLength={6}
                required
                autoFocus
                value={totpState.code}
                onChange={(e) => setTotpState((s) => ({ ...s, code: e.target.value }))}
                className="w-full bg-[#0a0a0f] border border-[#1e1e2e] rounded px-3 py-2 text-sm text-white tracking-widest focus:outline-none focus:border-[#6366f1]"
              />
            </div>

            {totpState.error && (
              <p className="text-xs text-red-400">{totpState.error}</p>
            )}

            <button
              type="submit"
              disabled={totpState.loading}
              className="w-full bg-[#6366f1] hover:bg-[#4f52c9] text-white text-sm font-medium py-2 rounded transition-colors disabled:opacity-50"
            >
              {totpState.loading ? 'Verifying…' : 'Sign In'}
            </button>

            <button
              type="button"
              onClick={() => setStep('password')}
              className="w-full text-xs text-[#6b7280] hover:text-white transition-colors"
            >
              ← Back
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

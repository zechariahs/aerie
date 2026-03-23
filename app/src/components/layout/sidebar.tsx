// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

'use client'; // Needs usePathname for active link highlighting and useState for mobile drawer

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { basePath } from '@/lib/client-url';

const navItems = [
  { href: '/', label: 'Command Center' },
  { href: '/crons', label: 'Cron Manager' },
  { href: '/costs', label: 'Cost & Tokens' },
  { href: '/tasks', label: 'Task Board' },
  { href: '/workspace', label: 'Workspace' },
  { href: '/claude-loop', label: 'Claude Loop' },
  { href: '/vps-health', label: 'VPS Health' },
  { href: '/security', label: 'Security' },
] as const;

interface NavListProps {
  onNavClick?: () => void;
}

function NavList({ onNavClick }: NavListProps): React.JSX.Element {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout(): Promise<void> {
    await fetch(basePath + '/api/auth/logout', { method: 'POST' });
    router.replace('/login');
  }

  return (
    <>
      <div className="px-4 py-4 border-b border-[#1e1e2e]">
        <span className="text-xs font-semibold text-[#6b7280] uppercase tracking-widest">
          Aerie
        </span>
      </div>

      <nav className="flex-1 py-2">
        {navItems.map(({ href, label }) => {
          const isActive = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavClick}
              className={[
                'block px-4 py-2 text-sm transition-colors',
                isActive
                  ? 'text-white bg-[#1e1e2e]'
                  : 'text-[#6b7280] hover:text-white hover:bg-[#1a1a27]',
              ].join(' ')}
            >
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="px-4 py-4 border-t border-[#1e1e2e]">
        <button
          onClick={() => { void handleLogout(); }}
          className="text-xs text-[#6b7280] hover:text-white transition-colors"
        >
          Sign out
        </button>
      </div>
    </>
  );
}

export function Sidebar(): React.JSX.Element {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      {/* Mobile hamburger button — only visible below md */}
      <button
        onClick={() => setMobileOpen(true)}
        className="md:hidden fixed top-2 left-3 z-50 p-1.5 rounded bg-[#12121a] border border-[#1e1e2e] text-[#6b7280] hover:text-white"
        aria-label="Open navigation"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
          <rect x="2" y="4" width="14" height="1.5" rx="0.75" />
          <rect x="2" y="8.25" width="14" height="1.5" rx="0.75" />
          <rect x="2" y="12.5" width="14" height="1.5" rx="0.75" />
        </svg>
      </button>

      {/* Desktop sidebar — hidden below md */}
      <aside className="hidden md:flex w-48 flex-shrink-0 border-r border-[#1e1e2e] flex-col bg-[#12121a] min-h-screen">
        <NavList />
      </aside>

      {/* Mobile off-canvas drawer */}
      {mobileOpen && (
        <>
          {/* Backdrop */}
          <div
            className="md:hidden fixed inset-0 z-40 bg-black/60"
            onClick={() => setMobileOpen(false)}
          />
          {/* Drawer */}
          <aside className="md:hidden fixed top-0 left-0 z-50 h-full w-56 flex flex-col bg-[#12121a] border-r border-[#1e1e2e] shadow-2xl">
            <div className="flex items-center justify-end px-3 py-3 border-b border-[#1e1e2e]">
              <button
                onClick={() => setMobileOpen(false)}
                className="text-[#6b7280] hover:text-white p-1"
                aria-label="Close navigation"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M3.293 3.293a1 1 0 011.414 0L8 6.586l3.293-3.293a1 1 0 011.414 1.414L9.414 8l3.293 3.293a1 1 0 01-1.414 1.414L8 9.414l-3.293 3.293a1 1 0 01-1.414-1.414L6.586 8 3.293 4.707a1 1 0 010-1.414z" />
                </svg>
              </button>
            </div>
            <div className="flex-1 flex flex-col overflow-y-auto">
              <NavList onNavClick={() => setMobileOpen(false)} />
            </div>
          </aside>
        </>
      )}
    </>
  );
}

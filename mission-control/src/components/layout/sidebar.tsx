// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

'use client'; // Needs usePathname for active link highlighting

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

const navItems = [
  { href: '/', label: 'Command Center' },
  { href: '/crons', label: 'Cron Manager' },
  { href: '/costs', label: 'Cost & Tokens' },
  { href: '/tasks', label: 'Task Board' },
  { href: '/workspace', label: 'Workspace' },
  { href: '/claude-loop', label: 'Claude Loop' },
  { href: '/vps-health', label: 'VPS Health' },
] as const;

export function Sidebar(): React.JSX.Element {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
  }

  return (
    <aside className="w-48 flex-shrink-0 border-r border-[#1e1e2e] flex flex-col bg-[#12121a] min-h-screen">
      <div className="px-4 py-4 border-b border-[#1e1e2e]">
        <span className="text-xs font-semibold text-[#6b7280] uppercase tracking-widest">
          Mission Control
        </span>
      </div>

      <nav className="flex-1 py-2">
        {navItems.map(({ href, label }) => {
          const isActive = pathname === href;
          return (
            <Link
              key={href}
              href={href}
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
          onClick={handleLogout}
          className="text-xs text-[#6b7280] hover:text-white transition-colors"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}

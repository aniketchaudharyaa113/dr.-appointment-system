'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useI18n, type Locale } from '@/lib/i18n';
import { getCurrentUser, setCurrentUser, type UserSession } from '@/lib/api';
import { Activity, ShieldAlert, Calendar, Stethoscope, User, Moon, Sun, Globe, LogOut } from 'lucide-react';

export function Navbar() {
  const { t, locale, setLocale } = useI18n();
  const pathname = usePathname();
  const [user, setUser] = useState<UserSession | null>(null);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    setUser(getCurrentUser());
    if (typeof window !== 'undefined') {
      const darkMode = document.documentElement.classList.contains('dark') ||
        window.matchMedia('(prefers-color-scheme: dark)').matches;
      setIsDark(darkMode);
    }
  }, []);

  const toggleTheme = () => {
    const nextDark = !isDark;
    setIsDark(nextDark);
    if (nextDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setUser(null);
    window.location.href = '/';
  };

  const navLinks = [
    { href: '/doctors', label: t.nav.findDoctors, icon: Stethoscope },
    { href: '/emergency', label: t.nav.emergency, icon: ShieldAlert, highlight: true },
    { href: '/appointments', label: t.nav.myAppointments, icon: Calendar },
    { href: '/doctor/dashboard', label: t.nav.doctorPortal, icon: Activity },
    { href: '/admin', label: t.nav.adminPortal, icon: User },
  ];

  return (
    <header className="sticky top-0 z-40 w-full border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-950/95 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand */}
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="w-10 h-10 rounded-xl bg-teal-600 text-white flex items-center justify-center shadow-md shadow-teal-500/20 group-hover:scale-105 transition-transform">
            <Activity className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-xl tracking-tight text-slate-900 dark:text-white">MediBook</span>
              <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-teal-100 dark:bg-teal-950 text-teal-700 dark:text-teal-300">
                Telehealth
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">Care & Dispatch</p>
          </div>
        </Link>

        {/* Desktop Nav */}
        <nav className="hidden md:flex items-center gap-1" aria-label="Main Navigation">
          {navLinks.map((link) => {
            const Icon = link.icon;
            const isActive = pathname === link.href;
            if (link.highlight) {
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                >
                  <Icon className="w-4 h-4 animate-pulse" />
                  <span>{link.label}</span>
                </Link>
              );
            }
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-teal-50 dark:bg-teal-950/50 text-teal-700 dark:text-teal-300 font-semibold'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-900'
                }`}
              >
                <Icon className="w-4 h-4 opacity-75" />
                <span>{link.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {/* Language Selector */}
          <div className="relative flex items-center bg-slate-100 dark:bg-slate-900 rounded-lg p-0.5 text-xs font-medium">
            <Globe className="w-3.5 h-3.5 ml-1.5 text-slate-500" />
            <select
              value={locale}
              onChange={(e) => setLocale(e.target.value as Locale)}
              className="bg-transparent border-none py-1 pl-1 pr-2 text-xs font-semibold text-slate-700 dark:text-slate-200 focus:outline-none cursor-pointer"
              aria-label="Select Language"
            >
              <option value="en" className="dark:bg-slate-900">EN</option>
              <option value="hi" className="dark:bg-slate-900">हिन्दी</option>
              <option value="bn" className="dark:bg-slate-900">বাংলা</option>
            </select>
          </div>

          {/* Theme Toggle */}
          <button
            onClick={toggleTheme}
            className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-900 transition-colors"
            aria-label="Toggle Dark Mode"
          >
            {isDark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-600" />}
          </button>

          {/* User Auth Info */}
          {user ? (
            <div className="flex items-center gap-2 pl-2 border-l border-slate-200 dark:border-slate-800">
              <span className="text-xs font-semibold px-2 py-1 bg-slate-100 dark:bg-slate-900 rounded-md text-slate-700 dark:text-slate-300">
                {user.name.split(' ')[0]} ({user.role})
              </span>
              <button
                onClick={handleLogout}
                className="p-1.5 text-slate-400 hover:text-rose-500 transition-colors"
                title="Sign Out"
                aria-label="Sign Out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <Link
              href="/auth/login"
              className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-teal-600 hover:bg-teal-700 text-white shadow-sm transition-colors"
            >
              {t.nav.login}
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

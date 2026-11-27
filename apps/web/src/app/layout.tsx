import type { Metadata } from 'next';
import Link from 'next/link';
import '@fontsource/plus-jakarta-sans/600.css';
import '@fontsource/plus-jakarta-sans/700.css';
import '@fontsource/plus-jakarta-sans/800.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/700.css';
import './globals.css';
import { I18nProvider } from '@/lib/i18n';
import { Providers } from '@/components/providers';
import { Navbar } from '@/components/navbar';
import { AiDrawer } from '@/components/ai-drawer';
import { BrandLogo } from '@/components/brand-logo';
import { PhoneCall, ShieldCheck } from 'lucide-react';

export const metadata: Metadata = {
  title: 'CuraBridge | Modern Telehealth, Health Passport & Emergency EMS',
  description:
    'Find NMC-verified specialists, lock consultation slots instantly, manage your digital Health Passport, and request 24/7 GPS ambulance dispatch.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="color-scheme" content="light dark" />
      </head>
      <body className="font-sans antialiased selection:bg-emerald-600 selection:text-white bg-white dark:bg-[#091310] text-[#132238] dark:text-slate-100 flex flex-col min-h-screen">
        <a
          href="#main-content"
          className="visually-hidden focus:not-sr-only fixed top-3 left-3 z-50 px-4 py-2 rounded-xl bg-emerald-700 text-white text-xs font-bold shadow-lg"
        >
          Skip to main content
        </a>
        <Providers>
          <I18nProvider>
            <Navbar />
            <main id="main-content" tabIndex={-1} className="flex-1 focus:outline-none">
              {children}
            </main>
            <AiDrawer />
            <footer className="bg-[#132B23] text-emerald-50/90 pt-14 pb-10 px-4 sm:px-6 lg:px-8 border-t border-emerald-950">
              <div className="max-w-7xl mx-auto space-y-10">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
                  <div className="space-y-3">
                    <BrandLogo variant="light" size="md" />
                    <p className="text-xs text-emerald-100/75 leading-relaxed max-w-xs">
                      One unified clinical workspace for verified doctor visits, encrypted LiveKit telehealth, portable Health Passports, and 24/7 EMS dispatch.
                    </p>
                    <a
                      href="tel:112"
                      className="no-touch-target inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-rose-500/20 border border-rose-400/30 text-rose-200 text-xs font-semibold hover:bg-rose-500/30 transition-colors"
                    >
                      <PhoneCall className="w-3.5 h-3.5" aria-hidden="true" />
                      Emergency Hotline: 112 / 108
                    </a>
                  </div>

                  <div className="space-y-3">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-white">Services</h3>
                    <ul className="space-y-2 text-xs text-emerald-100/75">
                      <li><Link href="/doctors" className="hover:text-white transition-colors">Find Specialists</Link></li>
                      <li><Link href="/appointments" className="hover:text-white transition-colors">My Appointments</Link></li>
                      <li><Link href="/passport" className="hover:text-white transition-colors">Health Passport &amp; Labs</Link></li>
                      <li><Link href="/emergency" className="hover:text-white transition-colors">Emergency Ambulance SOS</Link></li>
                    </ul>
                  </div>

                  <div className="space-y-3">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-white">Care Portals</h3>
                    <ul className="space-y-2 text-xs text-emerald-100/75">
                      <li><Link href="/auth/login" className="hover:text-white transition-colors">Patient &amp; Doctor Login</Link></li>
                      <li><Link href="/doctor/dashboard" className="hover:text-white transition-colors">Physician Workspace</Link></li>
                      <li><Link href="/admin" className="hover:text-white transition-colors">Compliance Admin Portal</Link></li>
                    </ul>
                  </div>

                  <div className="space-y-3">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-white">Standards</h3>
                    <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-2 text-xs text-emerald-100/80">
                      <p className="font-semibold text-white flex items-center gap-1.5">
                        <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden="true" />
                        Clinical Governance
                      </p>
                      <p className="text-[11px] leading-relaxed">
                        Built in alignment with India Telemedicine Practice Guidelines 2020 &amp; ABDM-ready record portability.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="pt-6 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-4 text-[11px] text-emerald-100/60">
                  <p>© 2026 CuraBridge Health Platform. All rights reserved.</p>
                  <p>Regional Clinical &amp; Emergency Hub • Kolkata (IST)</p>
                </div>
              </div>
            </footer>
          </I18nProvider>
        </Providers>
      </body>
    </html>
  );
}

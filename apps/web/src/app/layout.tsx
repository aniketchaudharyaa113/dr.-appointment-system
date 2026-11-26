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
import { Activity, PhoneCall, ShieldCheck } from 'lucide-react';

export const metadata: Metadata = {
  title: 'MediBook | Next-Gen Telehealth & Emergency EMS Platform',
  description:
    'Instant doctor consultations in Kolkata, certified digital prescriptions, and 24/7 priority emergency ambulance dispatch.',
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
      <body className="font-sans antialiased selection:bg-teal-500 selection:text-white bg-[#f7fafb] dark:bg-[#060b14] text-slate-900 dark:text-slate-100 flex flex-col min-h-screen">
        <a
          href="#main-content"
          className="visually-hidden focus:not-sr-only fixed top-3 left-3 z-50 px-4 py-2 rounded-xl bg-teal-600 text-white text-xs font-bold shadow-lg"
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
            <footer className="border-t border-slate-200/80 dark:border-slate-800/80 bg-white/80 dark:bg-[#0b1220]/90 backdrop-blur-md py-10 px-4 sm:px-6 lg:px-8 mt-20">
              <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8 items-center text-sm text-slate-600 dark:text-slate-400">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-lg bg-teal-600 text-white flex items-center justify-center">
                      <Activity className="w-4 h-4" aria-hidden="true" />
                    </span>
                    <span className="font-display font-bold text-base text-slate-900 dark:text-white">
                      MediBook Clinical
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-teal-600 shrink-0" aria-hidden="true" />
                    Compliant with India Telemedicine Practice Guidelines 2020
                  </p>
                </div>

                <nav className="flex flex-wrap items-center gap-5 text-xs font-semibold justify-start md:justify-center" aria-label="Footer Navigation">
                  <Link href="/doctors" className="hover:text-teal-600 dark:hover:text-teal-400 transition-colors">
                    Find Specialists
                  </Link>
                  <Link href="/appointments" className="hover:text-teal-600 dark:hover:text-teal-400 transition-colors">
                    My Appointments
                  </Link>
                  <Link href="/passport" className="hover:text-teal-600 dark:hover:text-teal-400 transition-colors">
                    Health Passport
                  </Link>
                  <Link href="/emergency" className="text-rose-600 dark:text-rose-400 hover:underline">
                    Emergency SOS
                  </Link>
                </nav>

                <div className="flex flex-wrap items-center gap-3 md:justify-end text-xs">
                  <a
                    href="tel:112"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 font-semibold border border-rose-200/80 dark:border-rose-900/60"
                  >
                    <PhoneCall className="w-3.5 h-3.5" aria-hidden="true" />
                    Emergency: 112 / 108
                  </a>
                  <span className="text-slate-400">Kolkata Regional EMS</span>
                </div>
              </div>
            </footer>
          </I18nProvider>
        </Providers>
      </body>
    </html>
  );
}

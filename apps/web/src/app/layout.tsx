import type { Metadata } from 'next';
import './globals.css';
import { I18nProvider } from '@/lib/i18n';
import { Navbar } from '@/components/navbar';
import { AiDrawer } from '@/components/ai-drawer';

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
    <html lang="en">
      <body className="antialiased selection:bg-teal-500 selection:text-white bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col min-h-screen">
        <I18nProvider>
          <Navbar />
          <main className="flex-1">{children}</main>
          <AiDrawer />
          <footer className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 py-8 px-4 sm:px-6 lg:px-8 mt-16 text-xs text-slate-500">
            <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-700 dark:text-slate-300">MediBook Telehealth</span>
                <span>•</span>
                <span>Compliant with India Telemedicine Practice Guidelines 2020</span>
              </div>
              <div className="flex items-center gap-4">
                <span>Emergency Hotline: 112 / 108</span>
                <span>•</span>
                <span>Kolkata Regional EMS</span>
              </div>
            </div>
          </footer>
        </I18nProvider>
      </body>
    </html>
  );
}

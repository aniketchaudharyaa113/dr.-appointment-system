import React from 'react';

export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col justify-between p-8 max-w-7xl mx-auto">
      <header className="flex justify-between items-center py-4 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center space-x-2">
          <div className="w-9 h-9 bg-teal-600 rounded-lg flex items-center justify-center text-white font-bold text-xl shadow-sm">
            M
          </div>
          <span className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
            MediBook
          </span>
        </div>
        <div className="flex items-center space-x-4">
          <a
            href="/emergency"
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg shadow-sm transition-colors flex items-center space-x-2"
          >
            <span>SOS Ambulance</span>
          </a>
          <a
            href="/login"
            className="px-4 py-2 border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg font-medium transition-colors"
          >
            Sign In
          </a>
        </div>
      </header>

      <section className="py-20 text-center space-y-6">
        <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-teal-50 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-800 text-teal-700 dark:text-teal-300 text-sm font-medium">
          <span className="w-2 h-2 rounded-full bg-teal-500 animate-pulse" />
          <span>India’s Most Trusted Telehealth & Emergency Network</span>
        </div>
        <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight text-slate-900 dark:text-white max-w-4xl mx-auto leading-tight">
          Specialist Consultations, Verified Prescriptions, Instant Care.
        </h1>
        <p className="text-lg text-slate-600 dark:text-slate-400 max-w-2xl mx-auto">
          Connect with top verified doctors over secure HD video within minutes, or dispatch an emergency ambulance with sub-second live GPS tracking.
        </p>

        <div className="max-w-xl mx-auto pt-6 flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            placeholder="Search symptoms, doctors, or specialties (e.g. Chest pain)..."
            className="flex-1 px-4 py-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
          <button className="px-6 py-3 bg-teal-600 hover:bg-teal-700 text-white font-medium rounded-lg shadow-sm transition-colors">
            Find Doctor
          </button>
        </div>
      </section>

      <footer className="py-6 border-t border-slate-200 dark:border-slate-800 text-center text-sm text-slate-500">
        &copy; {new Date().getFullYear()} MediBook Telehealth Platform. All medical records encrypted & compliant with Telemedicine Practice Guidelines.
      </footer>
    </main>
  );
}

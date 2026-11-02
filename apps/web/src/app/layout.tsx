import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'MediBook | Next-Gen Telehealth & Emergency Platform',
  description:
    'Instant doctor consultations, seamless digital prescriptions, and emergency ambulance dispatch.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased selection:bg-teal-500 selection:text-white">
        {children}
      </body>
    </html>
  );
}

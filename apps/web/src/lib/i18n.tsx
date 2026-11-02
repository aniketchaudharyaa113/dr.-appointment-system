'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { translations, type Locale } from './translations';

export { translations, type Locale };

interface I18nContextType {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (typeof translations)['en'];
}

const I18nContext = createContext<I18nContextType>({
  locale: 'en',
  setLocale: () => {},
  t: translations.en,
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en');

  useEffect(() => {
    const saved = localStorage.getItem('medibook_locale') as Locale;
    if (saved && (saved === 'en' || saved === 'hi' || saved === 'bn')) {
      setLocaleState(saved);
    }
  }, []);

  const setLocale = (newLocale: Locale) => {
    setLocaleState(newLocale);
    localStorage.setItem('medibook_locale', newLocale);
  };

  return (
    <I18nContext.Provider value={{ locale, setLocale, t: translations[locale] }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}

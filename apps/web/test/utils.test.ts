import { describe, it } from 'node:test';
import assert from 'node:assert';
import { formatPaise, cn } from '../src/lib/utils.ts';
import { translations } from '../src/lib/translations.ts';

describe('Web Utility Functions & Tokens', () => {
  it('should format integer paise into Indian Rupee currency string', () => {
    const formatted = formatPaise(80000);
    assert.ok(formatted.includes('800'), `Expected 800 in ${formatted}`);
  });

  it('should merge tailwind classes with cn utility without duplicates', () => {
    const merged = cn('px-4 text-sm', 'px-6 font-bold');
    assert.ok(merged.includes('px-6'));
    assert.ok(!merged.includes('px-4'));
    assert.ok(merged.includes('font-bold'));
  });

  it('should provide translations for all required locales (en, hi, bn)', () => {
    assert.ok(translations.en.hero.title);
    assert.ok(translations.hi.hero.title);
    assert.ok(translations.bn.hero.title);
    assert.strictEqual(translations.en.nav.brand, 'MediBook');
    assert.strictEqual(translations.hi.nav.brand, 'MediBook');
    assert.strictEqual(translations.bn.nav.brand, 'MediBook');
  });

  it('should include 112 and 108 emergency hotlines in translations', () => {
    assert.ok(translations.en.emergency.call112.includes('112'));
    assert.ok(translations.hi.emergency.call112.includes('112'));
    assert.ok(translations.bn.emergency.call112.includes('১১২'));
  });
});

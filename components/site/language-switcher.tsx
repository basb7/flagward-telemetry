'use client';

import { usePathname, useRouter } from 'next/navigation';
import { locales } from '@/i18n/config';
import { useI18n } from '@/i18n/locale-provider';
import { cn } from '@/lib/utils';

const LOCALE_COOKIE = 'NEXT_LOCALE';

/**
 * A compact two-option toggle. Swaps the leading `/{locale}` path segment,
 * remembers the choice in a cookie so `proxy.ts` honors it on the next
 * request with no locale in the URL, and navigates without a full reload.
 */
export function LanguageSwitcher() {
  const { locale, dictionary } = useI18n();
  const pathname = usePathname();
  const router = useRouter();

  const switchTo = (nextLocale: (typeof locales)[number]) => {
    if (nextLocale === locale) return;

    // biome-ignore lint/suspicious/noDocumentCookie: Cookie Store API isn't available in Safari; this is the one cookie the proxy reads back.
    document.cookie = `${LOCALE_COOKIE}=${nextLocale}; path=/; max-age=31536000; samesite=lax`;

    const segments = pathname.split('/');
    segments[1] = nextLocale;
    router.replace(segments.join('/') || `/${nextLocale}`);
  };

  return (
    <fieldset
      aria-label={dictionary.languageSwitcher.ariaLabel}
      className="inline-flex items-center gap-0.5 rounded-full border border-border bg-secondary/60 p-0.5"
    >
      {locales.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => switchTo(option)}
          aria-pressed={option === locale}
          className={cn(
            'rounded-full px-2 py-1 font-mono text-[11px] uppercase transition-colors',
            option === locale
              ? 'bg-background text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {option}
        </button>
      ))}
    </fieldset>
  );
}

import Link from 'next/link';
import { LanguageSwitcher } from '@/components/site/language-switcher';
import { Logo } from '@/components/site/logo';
import { ButtonLink } from '@/components/ui/button-link';
import type { Dictionary } from '@/i18n/dictionaries';
import { site } from '@/lib/site';

export function SiteHeader({
  locale,
  dict,
}: {
  locale: string;
  dict: Dictionary;
}) {
  return (
    <header className="border-b border-border/70">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
        <Link
          href={`/${locale}`}
          aria-label={dict.header.homeAriaLabel}
          className="flex items-center gap-3"
        >
          <Logo />
          <span className="rounded-full border border-border px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
            {dict.header.badge}
          </span>
        </Link>
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          <ButtonLink variant="ghost" size="sm" href={site.githubUrl}>
            {dict.header.github}
          </ButtonLink>
          <ButtonLink
            variant="ghost"
            size="sm"
            href={site.homeUrl}
            className="hidden sm:inline-flex"
          >
            {dict.header.website}
          </ButtonLink>
        </div>
      </div>
    </header>
  );
}

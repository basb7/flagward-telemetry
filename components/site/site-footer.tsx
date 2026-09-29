import { Logo } from '@/components/site/logo';
import type { Dictionary } from '@/i18n/dictionaries';

export function SiteFooter({ dict }: { dict: Dictionary }) {
  return (
    <footer className="mt-auto border-t border-border">
      <div className="mx-auto flex w-full max-w-6xl flex-col justify-between gap-4 px-5 py-10 text-[13px] text-muted-foreground sm:flex-row sm:items-end sm:px-8">
        <div className="max-w-sm">
          <Logo />
          <p className="mt-3 leading-relaxed">{dict.footer.tagline}</p>
        </div>
        <p>{dict.footer.copyright}</p>
      </div>
    </footer>
  );
}

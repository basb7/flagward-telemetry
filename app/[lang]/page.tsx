import { connection } from 'next/server';
import { Suspense } from 'react';
import { SiteFooter } from '@/components/site/site-footer';
import { SiteHeader } from '@/components/site/site-header';
import { StatsView } from '@/components/stats/stats-view';
import { ButtonLink } from '@/components/ui/button-link';
import { type Dictionary, getDictionary, getLocale } from '@/i18n/dictionaries';
import { site } from '@/lib/site';
import { getStats } from '@/lib/stats';

export default async function Page() {
  const locale = await getLocale();
  const dict = await getDictionary();

  return (
    <>
      <SiteHeader locale={locale} dict={dict} />
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-16 px-5 py-14 sm:px-8">
        <section className="max-w-3xl">
          <p className="font-mono text-[12px] uppercase tracking-wider text-muted-foreground">
            {dict.hero.eyebrow}
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">
            {dict.hero.title}
          </h1>
          <p className="mt-4 text-base leading-relaxed text-muted-foreground">
            {dict.hero.subtitle}
          </p>
          <div className="mt-6">
            <ButtonLink variant="outline" size="sm" href={site.statsPath}>
              {dict.hero.json}
            </ButtonLink>
          </div>
        </section>

        {/* Stats are read at request time; the rest of the page is static. */}
        <Suspense fallback={<StatsSkeleton />}>
          <LiveStats dict={dict} locale={locale} />
        </Suspense>

        <Privacy dict={dict} />
      </main>
      <SiteFooter dict={dict} />
    </>
  );
}

async function LiveStats({
  dict,
  locale,
}: {
  dict: Dictionary;
  locale: string;
}) {
  // Without this, Cache Components would fill getStats() at build time, where
  // there is no database.
  await connection();
  const stats = await getStats();
  return <StatsView stats={stats} dict={dict} locale={locale} />;
}

function StatsSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {['a', 'b', 'c'].map((key) => (
        <div
          key={key}
          className="h-40 animate-pulse rounded-xl border border-border bg-card"
        />
      ))}
    </div>
  );
}

function Privacy({ dict }: { dict: Dictionary }) {
  return (
    <section className="rounded-xl border border-border bg-card p-6 sm:p-8">
      <h2 className="text-lg font-semibold tracking-tight">
        {dict.privacy.title}
      </h2>
      <ul className="mt-4 flex max-w-3xl list-disc flex-col gap-2 pl-5 text-sm leading-relaxed text-muted-foreground">
        <li>{dict.privacy.collected}</li>
        <li>{dict.privacy.ip}</li>
        <li>{dict.privacy.groups}</li>
      </ul>
      <h3 className="mt-6 text-sm font-medium">{dict.privacy.disableTitle}</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        {dict.privacy.disableBody}
      </p>
      <pre className="mt-2 w-fit rounded-md border border-border bg-background px-3 py-2 font-mono text-[13px]">
        FLAGWARD_TELEMETRY=false
      </pre>
      <div className="mt-6 flex flex-wrap gap-2">
        <ButtonLink variant="outline" size="sm" href={site.fieldsUrl}>
          {dict.privacy.fields}
        </ButtonLink>
        <ButtonLink variant="ghost" size="sm" href={site.repoUrl}>
          {dict.privacy.source}
        </ButtonLink>
      </div>
    </section>
  );
}

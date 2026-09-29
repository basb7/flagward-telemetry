import type { Dictionary } from '@/i18n/dictionaries';
import { EVALUATION_BUCKETS } from '@/lib/schema/v1';
import type { PublishedCategory } from '@/lib/stats/fold';
import { OTHER, SMALL } from '@/lib/stats/fold';
import type { StatsV1 } from '@/lib/stats/query';
import { formatCount, formatPercent, valueLabel } from './format';

type Props = { stats: StatsV1; dict: Dictionary; locale: string };

export function StatsView({ stats, dict, locale }: Props) {
  const { headline } = stats;
  const updated = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(stats.generated_at));

  return (
    <div className="flex flex-col gap-12">
      <p className="font-mono text-[12px] text-muted-foreground">
        {dict.hero.updated.replace('{time}', `${updated} UTC`)}
      </p>

      <section className="grid gap-4 md:grid-cols-3">
        <HeadlineCard
          title={dict.headline.active7d}
          hint={dict.headline.establishedHint}
          byMode={headline.active_7d}
          dict={dict}
          locale={locale}
        />
        <HeadlineCard
          title={dict.headline.active30d}
          hint={dict.headline.establishedHint}
          byMode={headline.active_30d}
          dict={dict}
          locale={locale}
        />
        <Card>
          <CardTitle>{dict.headline.newUnconfirmed}</CardTitle>
          <p className="mt-3 text-4xl font-semibold tracking-tight">
            {formatCount(headline.new_unconfirmed_7d, locale)}
          </p>
          <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
            {dict.headline.newUnconfirmedHint}
          </p>
        </Card>
      </section>

      <Section title={dict.weekly.title}>
        <WeeklyChart weeks={stats.weekly_active} dict={dict} locale={locale} />
      </Section>

      {stats.enough_data && stats.breakdowns && stats.sdks && stats.features ? (
        <>
          <Section title={dict.features.title}>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Metric
                label={dict.features.multivariate}
                value={formatPercent(
                  stats.features.multivariate_percent,
                  locale,
                )}
              />
              <Metric
                label={dict.features.rollout}
                value={formatPercent(stats.features.rollout_percent, locale)}
              />
              <Metric
                label={dict.features.override}
                value={formatPercent(
                  stats.features.active_override_percent,
                  locale,
                )}
              />
              <Metric
                label={dict.features.medianFlags}
                value={formatCount(stats.features.median_flags, locale)}
              />
            </div>
          </Section>

          <Section title={dict.sdks.title} hint={dict.sdks.hint}>
            {stats.sdks.adoption.length === 0 ? (
              <p className="text-sm text-muted-foreground">{dict.sdks.empty}</p>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <BarList
                    rows={stats.sdks.adoption.map((row) => ({
                      label: valueLabel(row.type, dict),
                      share: row.percent === SMALL ? 0 : row.percent,
                      display:
                        row.percent === SMALL
                          ? `${SMALL} ${dict.breakdowns.installs}`
                          : formatPercent(row.percent, locale),
                    }))}
                  />
                </Card>
                {Object.entries(stats.sdks.versions).map(([type, versions]) => (
                  <Breakdown
                    key={type}
                    title={`${valueLabel(type, dict)} · ${dict.sdks.versions}`}
                    categories={versions}
                    dict={dict}
                    locale={locale}
                  />
                ))}
              </div>
            )}
          </Section>

          <Section title={dict.breakdowns.title}>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {(
                Object.keys(
                  stats.breakdowns,
                ) as (keyof typeof stats.breakdowns)[]
              ).map((name) => (
                <Breakdown
                  key={name}
                  title={dict.breakdowns[name]}
                  categories={
                    name === 'evaluations_24h_bucket'
                      ? inBucketOrder(stats.breakdowns?.[name] ?? [])
                      : (stats.breakdowns?.[name] ?? [])
                  }
                  dict={dict}
                  locale={locale}
                />
              ))}
            </div>
          </Section>
        </>
      ) : (
        <Card>
          <CardTitle>{dict.notEnough.title}</CardTitle>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {dict.notEnough.body}
          </p>
        </Card>
      )}
    </div>
  );
}

/** Volume buckets read low to high, not by how many installs fall in each. */
function inBucketOrder(categories: PublishedCategory[]) {
  const rank = (value: string) =>
    value === OTHER
      ? Number.POSITIVE_INFINITY
      : (EVALUATION_BUCKETS as readonly string[]).indexOf(value);
  return [...categories].sort((a, b) => rank(a.value) - rank(b.value));
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      {children}
    </div>
  );
}

function CardTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[13px] font-medium text-muted-foreground">
      {children}
    </h3>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {hint ? (
        <p className="mt-1 text-[13px] text-muted-foreground">{hint}</p>
      ) : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function HeadlineCard({
  title,
  hint,
  byMode,
  dict,
  locale,
}: {
  title: string;
  hint: string;
  byMode: StatsV1['headline']['active_7d'];
  dict: Dictionary;
  locale: string;
}) {
  return (
    <Card>
      <CardTitle>{title}</CardTitle>
      <p className="mt-3 text-4xl font-semibold tracking-tight">
        {formatCount(byMode.production + byMode.development, locale)}
      </p>
      <p className="mt-2 font-mono text-[12px] text-muted-foreground">
        {formatCount(byMode.production, locale)} {dict.headline.production} ·{' '}
        {formatCount(byMode.development, locale)} {dict.headline.development}
      </p>
      <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
        {hint}
      </p>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <p className="text-3xl font-semibold tracking-tight">{value}</p>
      <p className="mt-2 text-[13px] text-muted-foreground">{label}</p>
    </Card>
  );
}

function Breakdown({
  title,
  categories,
  dict,
  locale,
}: {
  title: string;
  categories: PublishedCategory[];
  dict: Dictionary;
  locale: string;
}) {
  const total = categories.reduce(
    (sum, row) => sum + (row.installs === SMALL ? 0 : row.installs),
    0,
  );
  return (
    <Card>
      <CardTitle>{title}</CardTitle>
      <div className="mt-4">
        <BarList
          rows={categories.map((row) => ({
            label: valueLabel(row.value, dict),
            share:
              row.installs === SMALL || total === 0
                ? 0
                : (row.installs / total) * 100,
            display: formatCount(row.installs, locale),
          }))}
        />
      </div>
    </Card>
  );
}

function BarList({
  rows,
}: {
  rows: { label: string; share: number; display: string }[];
}) {
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((row) => (
        <li key={row.label} className="text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <span className="truncate">{row.label}</span>
            <span className="font-mono text-[12px] text-muted-foreground">
              {row.display}
            </span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-muted">
            <div
              className="h-1.5 rounded-full bg-primary"
              style={{
                width: `${Math.max(row.share, row.share > 0 ? 2 : 0)}%`,
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function WeeklyChart({
  weeks,
  dict,
  locale,
}: {
  weeks: StatsV1['weekly_active'];
  dict: Dictionary;
  locale: string;
}) {
  if (weeks.length === 0) {
    return <p className="text-sm text-muted-foreground">{dict.weekly.empty}</p>;
  }
  const max = Math.max(...weeks.map((week) => week.installs));
  return (
    <Card>
      <div className="flex h-40 items-end gap-1">
        {weeks.map((week) => (
          <div
            key={week.week}
            title={`${week.week}: ${formatCount(week.installs, locale)}`}
            className="flex-1 rounded-t bg-primary/80"
            style={{ height: `${Math.max((week.installs / max) * 100, 2)}%` }}
          />
        ))}
      </div>
      <div className="mt-2 flex justify-between font-mono text-[11px] text-muted-foreground">
        <span>{weeks[0].week}</span>
        <span>{weeks[weeks.length - 1].week}</span>
      </div>
    </Card>
  );
}

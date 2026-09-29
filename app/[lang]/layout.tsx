import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { locales } from '@/i18n/config';
import { getDictionary, getLocale } from '@/i18n/dictionaries';
import { LocaleProvider } from '@/i18n/locale-provider';
import { site } from '@/lib/site';
import '../globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const dict = await getDictionary();

  return {
    metadataBase: new URL(site.url),
    title: dict.metadata.title,
    description: dict.metadata.description,
    alternates: {
      canonical: `/${locale}`,
      languages: { en: '/en', es: '/es', 'x-default': '/en' },
    },
    openGraph: {
      type: 'website',
      url: `/${locale}`,
      locale: locale === 'es' ? 'es_ES' : 'en_US',
      siteName: site.name,
      title: dict.metadata.title,
      description: dict.metadata.description,
    },
    robots: { index: true, follow: true },
  };
}

export const viewport: Viewport = {
  themeColor: '#000000',
  colorScheme: 'dark',
};

export function generateStaticParams() {
  return locales.map((lang) => ({ lang }));
}

export default async function RootLayout({ children }: LayoutProps<'/[lang]'>) {
  const locale = await getLocale();
  const dict = await getDictionary();

  return (
    <html
      lang={locale}
      className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <LocaleProvider locale={locale} dictionary={dict}>
          {children}
        </LocaleProvider>
      </body>
    </html>
  );
}

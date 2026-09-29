import type { ComponentProps } from 'react';

import { Button } from '@/components/ui/button';

type ButtonProps = ComponentProps<typeof Button>;

/**
 * A Button that renders an anchor.
 *
 * Base UI's Button assumes a native `<button>` when you replace the element
 * through `render`, and warns that swapping in anything else drops the native
 * button semantics. An anchor is exactly that case, so `nativeButton` has to be
 * false — and encapsulating it here means no call site has to remember.
 */
export function ButtonLink({
  href,
  external,
  ...props
}: Omit<ButtonProps, 'render' | 'nativeButton'> & {
  href: string;
  /** Defaults to true for absolute URLs, false for in-page anchors. */
  external?: boolean;
}) {
  const opensNewTab = external ?? /^https?:\/\//.test(href);

  return (
    <Button
      nativeButton={false}
      render={
        <a
          href={href}
          {...(opensNewTab
            ? { target: '_blank', rel: 'noreferrer noopener' }
            : {})}
        />
      }
      {...props}
    />
  );
}

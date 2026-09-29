import Image from 'next/image';
import { cn } from '@/lib/utils';

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      {/*
        Decorative on purpose: the adjacent text already reads as the brand
        name, so giving the mark its own alt text would have a screen reader
        announce the name twice.
      */}
      <Image
        src="/logo.png"
        alt=""
        width={19}
        height={24}
        className="h-6 w-auto"
        priority
      />
      <span className="text-[15px] font-semibold tracking-tight text-foreground">
        Flagward
      </span>
    </span>
  );
}

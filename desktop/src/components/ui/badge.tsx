import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        outline: 'text-foreground',
        success: 'border-transparent bg-emerald-100 text-emerald-900',
        warning: 'border-transparent bg-amber-100 text-amber-900',
        muted: 'border-transparent bg-muted text-muted-foreground',
      },
    },
    defaultVariants: { variant: 'secondary' },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

/** The badge an item or placement status gets. */
export const statusVariant = (status: string): VariantProps<typeof badgeVariants>['variant'] =>
  status === 'Approved'
    ? 'success'
    : status === 'Retired'
      ? 'muted'
      : status === 'InReview'
        ? 'warning'
        : 'outline';

import { cn } from '../utils';

type Status = 'online' | 'offline' | 'warning' | 'error';
type Size = 'sm' | 'md' | 'lg';

const STATUS_COLORS: Record<Status, string> = {
  online: 'bg-emerald-500',
  offline: 'bg-slate-500',
  warning: 'bg-amber-500',
  error: 'bg-rose-500',
};

const SIZES: Record<Size, string> = {
  sm: 'h-2 w-2',
  md: 'h-2.5 w-2.5',
  lg: 'h-3 w-3',
};

interface StatusDotProps {
  status: Status;
  size?: Size;
  pulse?: boolean;
  className?: string;
}

export function StatusDot({ status, size = 'md', pulse = false, className }: StatusDotProps) {
  return (
    <span className={cn('relative inline-flex', className)}>
      {pulse && status === 'online' && (
        <span
          className={cn(
            'absolute inline-flex rounded-full opacity-40 animate-ping',
            SIZES[size],
            STATUS_COLORS[status],
          )}
        />
      )}
      <span
        className={cn('relative inline-flex rounded-full', SIZES[size], STATUS_COLORS[status])}
      />
    </span>
  );
}

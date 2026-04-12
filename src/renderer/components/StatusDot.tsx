interface StatusDotProps {
  status: 'online' | 'offline' | 'warning' | 'idle';
  size?: 'sm' | 'md' | 'lg';
  pulse?: boolean;
}

const colorMap = {
  online: 'bg-emerald-500',
  offline: 'bg-gray-400',
  warning: 'bg-amber-500',
  idle: 'bg-blue-400',
} as const;

const pulseColorMap = {
  online: 'bg-emerald-400',
  offline: 'bg-gray-300',
  warning: 'bg-amber-400',
  idle: 'bg-blue-300',
} as const;

const sizeMap = {
  sm: 'h-2 w-2',
  md: 'h-2.5 w-2.5',
  lg: 'h-3 w-3',
} as const;

export function StatusDot({ status, size = 'md', pulse = false }: StatusDotProps) {
  return (
    <span className="relative inline-flex">
      {pulse && status === 'online' && (
        <span
          className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${pulseColorMap[status]}`}
        />
      )}
      <span
        className={`relative inline-flex rounded-full ${sizeMap[size]} ${colorMap[status]}`}
      />
    </span>
  );
}

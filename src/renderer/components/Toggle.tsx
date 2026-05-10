import { cn } from '../utils';

interface ToggleProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}

export function Toggle({ enabled, onChange, label, description, disabled }: ToggleProps) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!enabled)}
      disabled={disabled}
      className={cn(
        'flex items-center justify-between w-full px-4 py-3 rounded-xl transition-colors',
        'bg-slate-800/60 border border-slate-700/50',
        !disabled && 'hover:bg-slate-800 hover:border-slate-600/50',
        disabled && 'opacity-50 cursor-not-allowed',
      )}
    >
      <div className="text-left">
        <span className="text-sm font-medium text-slate-200">{label}</span>
        {description && <p className="text-xs text-slate-500 mt-0.5">{description}</p>}
      </div>
      <div
        className={cn(
          'relative h-6 w-11 rounded-full transition-colors duration-200 shrink-0 ml-3',
          enabled ? 'bg-blue-600' : 'bg-slate-600',
        )}
      >
        <div
          className={cn(
            'absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200',
            enabled && 'translate-x-5',
          )}
        />
      </div>
    </button>
  );
}

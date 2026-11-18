import { useTranslation } from 'react-i18next';
import type { AlarmLevel, AlarmSeverity } from '@/lib/utilityAlarms';
import { SEVERITY_STYLE } from '@/components/common/utility-alarms/meta';

export function SeverityPill({ severity, className = '' }: { severity: AlarmSeverity; className?: string }) {
  const { t } = useTranslation();
  const s = SEVERITY_STYLE[severity];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${s.pill} ${className}`}>
      <span className={`size-1.5 rounded-full ${s.dot}`} />
      {t(`utility_alarms.severity.${severity}`)}
    </span>
  );
}

const LEVEL_STYLE: Record<AlarmLevel, string> = {
  HH: 'bg-error-500 text-white',
  LL: 'bg-error-500 text-white',
  H: 'bg-warning-400 text-gray-900',
  L: 'bg-warning-400 text-gray-900',
  STATE: 'bg-gray-700 text-white dark:bg-gray-600',
  COMM: 'bg-gray-400 text-white dark:bg-gray-600',
};
export function LevelBadge({ level }: { level: AlarmLevel }) {
  const { t } = useTranslation();
  const label = level === 'STATE' ? t('utility_alarms.level.state') : level === 'COMM' ? t('utility_alarms.level.comm') : level;
  return <span className={`inline-flex min-w-9 justify-center rounded px-1.5 py-0.5 font-mono text-[11px] font-bold ${LEVEL_STYLE[level]}`}>{label}</span>;
}

/** สวิตช์แบบ controlled (Switch ของ template เป็นแบบ uncontrolled) */
export function Toggle({ checked, onChange, disabled, size = 'md', title }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; size?: 'sm' | 'md'; title?: string }) {
  const dims = size === 'sm' ? 'h-4 w-7' : 'h-5 w-9';
  const knob = size === 'sm' ? 'size-3' : 'size-4';
  const shift = size === 'sm' ? 'translate-x-3' : 'translate-x-4';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      title={title}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex shrink-0 items-center rounded-full p-0.5 transition-colors ${dims} ${checked ? 'bg-brand-500' : 'bg-gray-300 dark:bg-white/15'} ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
    >
      <span className={`rounded-full bg-white shadow transition-transform ${knob} ${checked ? shift : 'translate-x-0'}`} />
    </button>
  );
}


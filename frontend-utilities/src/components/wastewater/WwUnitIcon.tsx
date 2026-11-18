import { Cpu, Droplets, Filter, Layers, Waves, Wind, Zap } from 'lucide-react';
import type { WwUnitKey } from '@/lib/wastewaterUnits';

const ICONS = { eq: Waves, eqpump: Zap, aer: Wind, anae: Layers, sand: Filter, pool: Droplets, panel: Cpu } as const;

/** ไอคอนของแต่ละหน่วยบำบัดน้ำเสีย */
export default function WwUnitIcon({ unit, className = 'h-4.5 w-4.5' }: { unit: WwUnitKey; className?: string }) {
  const Icon = ICONS[unit];
  return <Icon className={className} />;
}

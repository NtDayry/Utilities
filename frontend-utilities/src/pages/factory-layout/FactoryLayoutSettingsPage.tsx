import { Navigate, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import PageMeta from '@/components/common/page/PageMeta';
import PageBreadcrumb from '@/components/common/navigation/PageBreadCrumb';
import { SectionHeader } from '@/components/ui/widget';
import { Table, TableBody, TableCell, TableHeader, TableRow } from '@/components/ui/table';
import Button from '@/components/ui/button/Button';
import { DuoSettingsIcon } from '@/icons';
import { URL } from '@/api';
import { useAuthStore } from '@/store/auth';
import { useFactorySensorSettings, isAdminRole } from '@/store/factorySensorSettings';
import { useSharedSettingsStatus } from '@/lib/sharedSettings';
import { SENSORS, SENSOR_GROUPS, sensorFields, sensorKeys, hiddenOf, type SensorGroup } from '@/lib/factorySensors';

// สีแถบหัวการ์ดของแต่ละกลุ่ม (โทนเดียวกับหน้า Sensor Calibration)
const GROUP_COLOR: Record<SensorGroup, string> = { power: '#f59e0b', transformer: '#f97316', water: '#60a5fa', pw: '#818cf8', wastewater: '#7c9a2e' };

// สวิตช์แบบเดียวกับหน้า Sensor Calibration (checkbox + peer) — tone: เขียว = แสดงผล, แดง = alarm
function Toggle({ on, onChange, label, disabled, tone = 'emerald' }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; tone?: 'emerald' | 'red' }) {
  return (
    <label className={`relative inline-flex items-center shrink-0 ${disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}`} title={label}>
      <input type="checkbox" className="sr-only peer" checked={on} disabled={disabled} aria-label={label} onChange={(e) => onChange(e.target.checked)} />
      <div className={`w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-gray-600 ${tone === 'red' ? 'peer-checked:bg-red-500 dark:peer-checked:bg-red-500' : 'peer-checked:bg-emerald-500 dark:peer-checked:bg-emerald-500'}`}></div>
    </label>
  );
}

// หน้าตั้งค่าแผนผังโรงงาน (admin): เปิด/ปิดเซ็นเซอร์ (ไอคอนบนแผนผัง) + เลือกช่องรายละเอียดที่แสดงเมื่อคลิกจุดนั้น
export default function FactoryLayoutSettingsPage() {
  const { t, i18n } = useTranslation();
  // ชื่อกลุ่ม/เซ็นเซอร์/ฟิลด์ (ข้อความมาจาก locales ผ่าน lib/factorySensors) ตามภาษาปัจจุบัน
  const nameOf = (o: { th: string; en: string }) => (i18n.language?.startsWith('th') ? o.th : o.en);
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.role);
  const { disabled, hiddenFields, alarms, alarmOff, setAlarms, setAlarm, setEnabled, setAllEnabled, setField, setAllFields, reset } = useFactorySensorSettings();

  const saveError = useSharedSettingsStatus((st) => st.saveError);
  if (!isAdminRole(role)) return <Navigate to={URL.HOME} replace />;

  const enabledCount = SENSORS.filter((s) => !disabled.includes(s.key)).length;
  const allKeys = SENSORS.map((s) => s.key);
  const HEADERS = [
    { label: t('factory_layout3d.settings_page.sensor'), align: 'start' },
    { label: t('factory_layout3d.settings_page.main_value'), align: 'center' },
    { label: t('factory_layout3d.settings_page.show_on_layout'), align: 'center' },
    { label: t('factory_layout3d.settings_page.show_alarm'), align: 'center' },
    { label: t('factory_layout3d.settings_page.details_on_click'), align: 'start' },
    { label: '', align: 'center' },
  ] as const;

  return (
    <>
      <PageMeta title={t('factory_layout3d.settings_page.factory_layout_settings')} description="" />
      <PageBreadcrumb
        pageTitle={t('factory_layout3d.settings_page.factory_layout_settings')}
        pageSubTitle={t('factory_layout3d.settings_page.enable_sensors_on_the_3d_layout')}
        icon={<DuoSettingsIcon className="inline-block mr-1 text-sky-500 w-13 h-13" />}
      />

      <div className="space-y-6">
        {saveError && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
            {t('water_systems.error.save_failed')}
          </div>
        )}
        {/* แถบสถานะ + ปุ่มรวม */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full border bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              {t('factory_layout3d.settings_page.enabled')} {enabledCount} / {SENSORS.length}
            </span>
            {enabledCount < SENSORS.length && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full border bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/30">
                <span className="w-2 h-2 rounded-full bg-gray-400" />
                {t('factory_layout3d.settings_page.disabled')} {SENSORS.length - enabledCount}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant={{ light: 'neutral-soft', dark: 'neutral-soft-outline' }} className="text-xs" onClick={() => navigate(URL.HOME)}>
              {t('factory_layout3d.settings_page.back_to_layout')}
            </Button>
            <Button variant={{ light: 'success-soft', dark: 'success-soft-outline' }} className="text-xs" onClick={() => setAllEnabled(allKeys, true)}>
              {t('factory_layout3d.settings_page.enable_all')}
            </Button>
            <Button variant={{ light: 'error-soft', dark: 'error-soft-outline' }} className="text-xs" onClick={() => setAllEnabled(allKeys, false)}>
              {t('factory_layout3d.settings_page.disable_all')}
            </Button>
            <Button variant={{ light: 'primary-soft', dark: 'primary-soft-outline' }} className="text-xs" onClick={reset}>
              {t('factory_layout3d.settings_page.reset_to_defaults')}
            </Button>
          </div>
        </div>

        {/* สวิตช์รวม: แสดง alarm บนแผนผัง */}
        <div className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03] overflow-hidden shadow-sm">
          <div className="flex items-center justify-between gap-3 px-5 py-4 md:px-6 bg-gray-50/50 dark:bg-gray-900/30">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-red-500/10 text-red-600 dark:text-red-400">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </span>
              <div>
                <span className="text-sm font-bold text-gray-900 dark:text-white block leading-tight">{t('factory_layout3d.settings_page.show_alarms_on_layout')}</span>
                <span className="text-[11px] text-gray-400">
                  {t('factory_layout3d.settings_page.icon_and_value_label_blink_red')}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-xs font-bold ${alarms ? 'text-red-600 dark:text-red-400' : 'text-gray-500'}`}>{alarms ? t('factory_layout3d.settings_page.on') : t('factory_layout3d.settings_page.off')}</span>
              <Toggle on={alarms} onChange={setAlarms} label={t('factory_layout3d.settings_page.show_alarms_on_layout')} tone="red" />
            </div>
          </div>
        </div>

        {SENSOR_GROUPS.map((g) => {
          const list = SENSORS.filter((s) => s.group === g.id);
          const keys = list.map((s) => s.key);
          const groupOn = keys.every((k) => !disabled.includes(k));
          const groupCount = keys.filter((k) => !disabled.includes(k)).length;
          return (
            <div
              key={g.id}
              className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03] overflow-hidden transition-all duration-200 shadow-sm hover:shadow-md"
            >
              {/* Card header */}
              <div className="flex items-center justify-between px-5 pt-5 pb-4 md:px-6 bg-gray-50/50 dark:bg-gray-900/30 border-b border-gray-100 dark:border-white/[0.05]">
                <SectionHeader
                  title={nameOf(g)}
                  subtitle={t('factory_layout3d.settings_page.groupcount_length_enabled', { groupCount, length: list.length })}
                  accent={GROUP_COLOR[g.id]}
                  className="!mb-0"
                />
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-gray-400">{t('factory_layout3d.settings_page.whole_group')}</span>
                  <Toggle on={groupOn} onChange={(v) => setAllEnabled(keys, v)} label={nameOf(g)} />
                </div>
              </div>

              {/* Table */}
              <div className="max-w-full overflow-x-auto custom-scrollbar">
                <Table className="min-w-[980px]">
                  <TableHeader className="border-b border-gray-100 dark:border-white/[0.05]">
                    <TableRow>
                      {HEADERS.map((h, i) => (
                        <TableCell
                          key={i}
                          isHeader
                          className={`px-4 py-3 bg-gray-500/10 dark:bg-gray-800/80 font-medium text-gray-500 text-theme-sm dark:text-white/70 text-${h.align}`}
                        >
                          {h.label}
                        </TableCell>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody className="divide-y divide-gray-100 dark:divide-white/[0.05]">
                    {list.map((s) => {
                      const on = !disabled.includes(s.key);
                      const fields = sensorFields(s);
                      const hidden = hiddenOf(hiddenFields, s.key);
                      return (
                        <TableRow key={s.key} className="hover:bg-primary/5 dark:hover:bg-gray-800/60 transition-colors">
                          {/* ชื่อเซ็นเซอร์ */}
                          <TableCell className="px-4 py-2 text-start w-[260px]">
                            <span className={`text-sm font-medium ${on ? 'text-gray-700 dark:text-gray-200' : 'text-gray-400 dark:text-gray-500'}`}>
                              {nameOf(s)}
                            </span>
                            <br />
                            <span className="text-xs text-gray-400 dark:text-gray-500 font-mono">{sensorKeys(s).join(' + ')}</span>
                          </TableCell>

                          {/* หน่วยค่าหลัก */}
                          <TableCell className="px-4 py-2 text-center w-[110px]">
                            <span className="text-xs font-mono px-2 py-1 rounded bg-amber-500/10 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 font-semibold border border-amber-500/20 inline-block min-w-[60px]">
                              {s.unit}
                            </span>
                          </TableCell>

                          {/* แสดงไอคอนบนแผนผัง */}
                          <TableCell className="px-4 py-2 text-center w-[140px]">
                            <div className="flex justify-center">
                              <Toggle on={on} onChange={(v) => setEnabled(s.key, v)} label={nameOf(s)} />
                            </div>
                          </TableCell>

                          {/* แสดง alarm ของจุดนี้ */}
                          <TableCell className="px-4 py-2 text-center w-[120px]">
                            <div className="flex justify-center">
                              <Toggle
                                on={!alarmOff.includes(s.key)}
                                onChange={(v) => setAlarm(s.key, v)}
                                label={t('factory_layout3d.settings_page.show_alarm')}
                                disabled={!on || !alarms}
                                tone="red"
                              />
                            </div>
                          </TableCell>

                          {/* ช่องรายละเอียด */}
                          <TableCell className="px-4 py-2 text-start">
                            {fields.length === 0 ? (
                              <span className="text-xs text-gray-400 font-mono">-</span>
                            ) : (
                              <div className={`flex flex-wrap gap-1.5 ${on ? '' : 'opacity-40 pointer-events-none'}`}>
                                {fields.map((fd) => {
                                  const show = !hidden.includes(fd.id);
                                  return (
                                    <button
                                      key={fd.id}
                                      type="button"
                                      aria-pressed={show}
                                      disabled={!on}
                                      onClick={() => setField(s.key, fd.id, !show)}
                                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] border transition-all hover:shadow-sm ${
                                        show
                                          ? 'bg-emerald-500/10 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 font-semibold'
                                          : 'bg-gray-50 dark:bg-gray-900 text-gray-400 dark:text-gray-500 border-gray-200 dark:border-gray-700'
                                      }`}
                                    >
                                      {nameOf(fd)}
                                      {fd.u && <span className="font-mono opacity-70">{fd.u}</span>}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </TableCell>

                          {/* เลือก/ไม่เลือกทั้งหมด */}
                          <TableCell className="px-4 py-2 text-center w-[120px]">
                            {fields.length > 1 ? (
                              <Button
                                size="sm"
                                variant={{ light: 'primary-soft', dark: 'primary-soft-outline' }}
                                disabled={!on}
                                onClick={() => setAllFields(s.key, fields.map((x) => x.id), hidden.length > 0)}
                                className="min-w-[90px] text-xs"
                              >
                                {hidden.length > 0 ? t('factory_layout3d.settings_page.select_all') : t('factory_layout3d.settings_page.clear')}
                              </Button>
                            ) : (
                              <span className="text-xs text-gray-400 font-mono">-</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
          );
        })}

        <p className="px-1 text-[11px] text-gray-400">
          {t('factory_layout3d.settings_page.settings_are_saved_automatically_in_this')}
        </p>
      </div>
    </>
  );
}

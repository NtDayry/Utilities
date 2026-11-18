import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BTN_OUTLINE, BTN_SAVE, INPUT_CLS } from '@/components/purified-water/settings/pwMqttStyles';
import useSwalAlert from '@/hooks/useSwalAlert';
import {
  PW_MQTT_PASSWORD_MASK,
  apiErrorDetail,
  probePwMqtt,
  putPwMqttBroker,
  type PwMqttBroker,
  type PwMqttConfig,
  type PwMqttStatus,
} from '@/api/purifiedWater/pwMqttApi';

interface Props {
  config: PwMqttConfig | null;
  status: PwMqttStatus | null;
  canEdit: boolean;
  onSaved: () => void;
}

const EMPTY: PwMqttBroker = { url: '', username: '', password: '', enabled: true };

/** การ์ด "แหล่งข้อมูล MQTT": broker ที่ backend ใช้รับค่าเซนเซอร์ Purified Water + สถานะการเชื่อมต่อ */
export function PwMqttSourcePanel({ config, status, canEdit, onSaved }: Props) {
  const { t } = useTranslation();
  const swal = useSwalAlert();
  const [form, setForm] = useState<PwMqttBroker>(EMPTY);
  const [collapsed, setCollapsed] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testTopic, setTestTopic] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const saved = config?.broker.url ? config.broker : { ...(config?.broker ?? EMPTY), enabled: true };
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);

  useEffect(() => {
    // ยังไม่ได้ตั้ง broker → เปิดการ์ดไว้ให้เห็นทันที และเปิดใช้งานเป็นค่าเริ่มต้น
    if (config && !config.broker.url) {
      setForm({ ...config.broker, enabled: true });
      setCollapsed(false);
    } else {
      setForm(config?.broker ?? EMPTY);
    }
  }, [config]);

  useEffect(() => {
    if (!testTopic && config?.mappings.length) setTestTopic(config.mappings[0].topic);
  }, [config, testTopic]);

  const mappedCount = config?.mappings.filter((m) => m.topic).length ?? 0;
  const connected = !!status?.connected;
  const configured = !!saved.url && saved.enabled;

  const handleSave = async () => {
    setSaving(true);
    try {
      await putPwMqttBroker({ ...form, url: form.url.trim(), username: form.username.trim() });
      swal.Toast({ title: t('page.settings_devices.mqtt.saved'), icon: 'success' });
      onSaved();
    } catch (err) {
      const msg = apiErrorDetail(err)?.errors?.url ? t('page.settings_devices.mqtt.url_invalid') : t('page.settings_devices.mqtt.save_failed');
      swal.error({ title: t('page.settings_devices.mqtt.save_failed'), message: msg });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!testTopic.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await probePwMqtt(testTopic.trim(), form.url.trim() ? form : undefined, 8);
      setTestResult(
        res.ok
          ? t('page.settings_devices.mqtt.test_ok', { ms: res.connectedMs, count: res.fields.length })
          : res.stage === 'connect'
            ? t('page.settings_devices.mqtt.test_connect_failed', { error: res.error })
            : t('page.settings_devices.mqtt.test_no_message'),
      );
    } catch {
      setTestResult(t('page.settings_devices.mqtt.test_failed'));
    } finally {
      setTesting(false);
    }
  };

  const badge = !configured
    ? { cls: 'bg-gray-500/10 text-gray-500 border-gray-400/30', dot: 'bg-gray-400', text: t('page.settings_devices.mqtt.not_configured') }
    : connected
      ? { cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30', dot: 'bg-emerald-500 animate-pulse', text: t('page.settings_devices.mqtt.connected') }
      : { cls: 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/30', dot: 'bg-rose-500', text: t('page.settings_devices.mqtt.disconnected') };

  return (
    <div className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03] overflow-hidden shadow-sm" data-testid="pw-mqtt-panel">
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-5 py-4 md:px-6 bg-gray-50/50 dark:bg-gray-900/30 border-b border-gray-100 dark:border-white/[0.05] hover:bg-gray-100/60 dark:hover:bg-gray-900/50 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-400">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
            </svg>
          </span>
          <div className="text-left">
            <span className="text-sm font-bold text-gray-900 dark:text-white block leading-tight">{t('page.settings_devices.mqtt.title')}</span>
            <span className="text-[11px] text-gray-400">
              {t('page.settings_devices.mqtt.subtitle', { count: mappedCount, topics: status?.topics.length ?? 0 })}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 text-[11px] font-semibold rounded-full border ${badge.cls}`} data-testid="pw-mqtt-badge">
            <span className={`w-2 h-2 rounded-full ${badge.dot}`} />
            {badge.text}
          </span>
          <svg className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${collapsed ? '' : 'rotate-180'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {!collapsed && (
        <div className="p-5 md:p-6 space-y-5">
          {configured && !connected && status?.error && (
            <div className="text-xs rounded-lg px-3 py-2 bg-rose-500/10 text-rose-700 dark:text-rose-300 border border-rose-500/20 font-mono break-all">
              {status.error}
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="space-y-1.5 md:col-span-2">
              <span className="text-xs font-semibold text-gray-700 dark:text-gray-200 block">{t('page.settings_devices.mqtt.url')}</span>
              <input className={INPUT_CLS}
                value={form.url}
                disabled={!canEdit}
                placeholder="mqtt://192.168.12.77:1884"
                onChange={(e) => setForm({ ...form, url: e.target.value })}
                data-testid="pw-mqtt-url"
              />
              <span className="text-[11px] text-gray-400">{t('page.settings_devices.mqtt.url_hint')}</span>
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-semibold text-gray-700 dark:text-gray-200 block">{t('page.settings_devices.mqtt.username')}</span>
              <input className={INPUT_CLS} value={form.username} disabled={!canEdit} onChange={(e) => setForm({ ...form, username: e.target.value })} data-testid="pw-mqtt-username" />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-semibold text-gray-700 dark:text-gray-200 block">{t('page.settings_devices.mqtt.password')}</span>
              <input className={INPUT_CLS}
                type="password"
                value={form.password}
                disabled={!canEdit}
                placeholder={saved.password === PW_MQTT_PASSWORD_MASK ? t('page.settings_devices.mqtt.password_keep') : ''}
                onFocus={() => form.password === PW_MQTT_PASSWORD_MASK && setForm({ ...form, password: '' })}
                onBlur={() => !form.password && saved.password === PW_MQTT_PASSWORD_MASK && setForm({ ...form, password: PW_MQTT_PASSWORD_MASK })}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                data-testid="pw-mqtt-password"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="inline-flex items-center gap-2 text-xs font-medium text-gray-700 dark:text-gray-200 cursor-pointer">
              <input
                type="checkbox"
                checked={form.enabled}
                disabled={!canEdit}
                onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                className="w-4 h-4 accent-emerald-500"
                data-testid="pw-mqtt-enabled"
              />
              {t('page.settings_devices.mqtt.enabled')}
            </label>
            {canEdit && (
              <button type="button" className={BTN_SAVE}
                disabled={!dirty || saving}
                onClick={handleSave}
                data-testid="pw-mqtt-save"
              >
                {saving ? t('page.settings_devices.mqtt.saving') : t('page.settings_devices.mqtt.save')}
              </button>
            )}
          </div>

          {canEdit && (
            <div className="pt-4 border-t border-gray-100 dark:border-white/[0.05] space-y-2">
              <span className="text-xs font-semibold text-gray-700 dark:text-gray-200 block">{t('page.settings_devices.mqtt.test_title')}</span>
              <div className="flex gap-2">
                <div className="flex-1">
                  <input className={INPUT_CLS} value={testTopic} placeholder="purified-water/ro" onChange={(e) => setTestTopic(e.target.value)} data-testid="pw-mqtt-test-topic" />
                </div>
                <button type="button" className={BTN_OUTLINE} disabled={testing || !testTopic.trim() || !form.url.trim()} onClick={handleTest} data-testid="pw-mqtt-test">
                  {testing ? t('page.settings_devices.mqtt.testing') : t('page.settings_devices.mqtt.test')}
                </button>
              </div>
              {testResult && <div className="text-xs text-gray-600 dark:text-gray-300" data-testid="pw-mqtt-test-result">{testResult}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

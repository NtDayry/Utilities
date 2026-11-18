import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Radio } from 'lucide-react';
import useSwalAlert from '@/hooks/useSwalAlert';
import {
  BROKER_PASSWORD_MASK,
  getWaterSupplyMqtt,
  probeMqtt,
  putWaterSupplyMqtt,
  WATER_SUPPLY_SYSTEM_ID,
  type WaterSupplyMqtt,
} from '@/api/utilities/utilitiesApi';
import { refreshWaterSupplySource, useWaterSupplySource } from '@/lib/waterSupply/source';
import { BTN_OUTLINE, BTN_SAVE, INPUT_CLS } from '@/components/purified-water/settings/pwMqttStyles';

interface Form {
  topic: string;
  custom: boolean;
  url: string;
  username: string;
  password: string;
}

const toForm = (c: WaterSupplyMqtt): Form => ({
  topic: c.topic,
  custom: c.broker !== null,
  url: c.broker?.url ?? '',
  username: c.broker?.username ?? '',
  password: c.broker?.password ?? '',
});
const toCfg = (f: Form): WaterSupplyMqtt => ({
  topic: f.topic.trim(),
  broker: f.custom ? { url: f.url.trim(), username: f.username.trim(), password: f.password } : null,
});

/**
 * การ์ดตั้งค่า MQTT ของบ่อน้ำประปาโรงงาน + ระบบปั๊ม (admin) — topic หลัก + broker (พื้นฐานของ backend หรือกำหนดเอง)
 * backend เป็นผู้ต่อ broker ; หน้าเว็บทุกหน้าใช้ค่าใหม่ทันทีหลังบันทึก
 */
export function WaterSupplyMqttCard({ connected, defaultOpen = false }: { connected: boolean; defaultOpen?: boolean }) {
  const { t } = useTranslation();
  const swal = useSwalAlert();
  const src = useWaterSupplySource();
  const [saved, setSaved] = useState<Form | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [open, setOpen] = useState(defaultOpen);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  /** null = โหลดได้ ; ตัวเลข = HTTP status (0 = ติดต่อ backend ไม่ได้) */
  const [loadError, setLoadError] = useState<number | null>(null);

  useEffect(() => {
    getWaterSupplyMqtt()
      .then((c) => {
        setSaved(toForm(c));
        setForm(toForm(c));
      })
      .catch((e: unknown) => setLoadError((e as { response?: { status?: number } })?.response?.status ?? 0));
  }, []);

  const dirty = !!form && !!saved && JSON.stringify(form) !== JSON.stringify(saved);
  const patch = (p: Partial<Form>) => {
    setForm((f) => (f ? { ...f, ...p } : f));
    setTestResult(null);
  };

  const handleTest = async () => {
    if (!form) return;
    setTesting(true);
    setTestResult(null);
    try {
      const cfg = toCfg(form);
      const res = await probeMqtt({ broker: cfg.broker, topic: cfg.topic, timeout_sec: 8, system_id: WATER_SUPPLY_SYSTEM_ID });
      setTestResult(
        res.ok
          ? { ok: true, text: t('water_supply.mqtt_source.test_ok', { ms: res.connectedMs, count: res.points.length }) }
          : {
              ok: false,
              text:
                res.stage === 'connect'
                  ? t('water_supply.mqtt_source.test_connect_failed', { error: res.error })
                  : t('water_supply.mqtt_source.test_no_message', { topic: cfg.topic }),
            },
      );
    } catch {
      setTestResult({ ok: false, text: t('water_supply.mqtt_source.test_failed') });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!form) return;
    setSaving(true);
    try {
      const res = await putWaterSupplyMqtt(toCfg(form));
      setSaved(toForm(res));
      setForm(toForm(res));
      await refreshWaterSupplySource();
      swal.Toast({ title: t('water_supply.mqtt_source.saved'), icon: 'success' });
    } catch (err) {
      const errors = (err as { response?: { data?: { detail?: { errors?: Record<string, string> } } } })?.response?.data?.detail?.errors ?? {};
      const msg = errors.topic
        ? t('water_supply.mqtt_source.topic_invalid')
        : errors.url
          ? t('water_supply.mqtt_source.url_invalid')
          : t('water_supply.mqtt_source.save_failed');
      swal.error({ title: t('water_supply.mqtt_source.save_failed'), message: msg });
    } finally {
      setSaving(false);
    }
  };

  const summary = src.topic ? `${src.topic} @ ${src.brokerUrl}` : '-';
  const canSave = !!form && dirty && !saving && !!form.topic.trim() && (!form.custom || !!form.url.trim());

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-white/[0.03]" data-testid="ws-mqtt-card">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full cursor-pointer items-center justify-between gap-3 px-5 py-4 text-left"
        data-testid="ws-mqtt-toggle"
      >
        <div className="flex min-w-0 items-center gap-3">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-400">
            <Radio className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <span className="block text-sm font-bold text-gray-900 dark:text-white">{t('water_supply.mqtt_source.title')}</span>
            <span className="block truncate font-mono text-[11px] text-gray-500 dark:text-gray-400" data-testid="ws-mqtt-summary">
              {summary}
              {src.loaded && !src.customBroker && ` · ${t('water_supply.mqtt_source.default_broker_short')}`}
            </span>
          </div>
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
            connected
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
              : 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400'
          }`}
        >
          <span className={`h-2 w-2 rounded-full ${connected ? 'animate-pulse bg-emerald-500' : 'bg-rose-500'}`} />
          {connected ? t('water_supply.mqtt_source.connected') : t('water_supply.mqtt_source.disconnected')}
        </span>
      </button>

      {open && (
        <div className="space-y-5 border-t border-gray-100 px-5 py-5 dark:border-gray-800">
          {loadError !== null && (
            <div className="text-sm text-rose-600 dark:text-rose-400" data-testid="ws-mqtt-load-error">
              {t('water_supply.mqtt_source.load_failed')} ({loadError ? `HTTP ${loadError}` : t('water_supply.mqtt_source.no_response')})
              {loadError === 404 && <div className="mt-1 text-xs">{t('water_supply.mqtt_source.load_failed_404')}</div>}
            </div>
          )}
          {form && (
            <>
              <label className="block space-y-1.5">
                <span className="block text-xs font-semibold text-gray-700 dark:text-gray-200">{t('water_supply.mqtt_source.topic')}</span>
                <input className={INPUT_CLS} value={form.topic} onChange={(e) => patch({ topic: e.target.value })} data-testid="ws-mqtt-topic" />
                <span className="block text-[11px] text-gray-400">{t('water_supply.mqtt_source.topic_hint', { topic: form.topic.trim() || 'topic' })}</span>
              </label>

              <div className="space-y-2">
                <span className="block text-xs font-semibold text-gray-700 dark:text-gray-200">{t('water_supply.mqtt_source.broker')}</span>
                <div className="grid gap-2 sm:grid-cols-2">
                  {[false, true].map((custom) => (
                    <label
                      key={String(custom)}
                      className={`flex cursor-pointer items-start gap-2 rounded-xl border p-3 text-sm ${
                        form.custom === custom ? 'border-sky-500/50 bg-sky-500/5' : 'border-gray-200 dark:border-gray-700'
                      }`}
                    >
                      <input
                        type="radio"
                        name="ws-mqtt-broker"
                        className="mt-0.5 accent-sky-500"
                        checked={form.custom === custom}
                        onChange={() => patch({ custom })}
                        data-testid={custom ? 'ws-mqtt-custom' : 'ws-mqtt-default'}
                      />
                      <span>
                        <span className="block font-semibold text-gray-800 dark:text-white/90">
                          {custom ? t('water_supply.mqtt_source.custom_broker') : t('water_supply.mqtt_source.default_broker')}
                        </span>
                        <span className="block text-[11px] text-gray-500 dark:text-gray-400">
                          {custom ? t('water_supply.mqtt_source.custom_broker_hint') : t('water_supply.mqtt_source.default_broker_hint')}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {form.custom && (
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-1.5 md:col-span-2">
                    <span className="block text-xs font-semibold text-gray-700 dark:text-gray-200">{t('water_supply.mqtt_source.url')}</span>
                    <input
                      className={INPUT_CLS}
                      value={form.url}
                      placeholder="mqtt://192.168.12.77:1884"
                      onChange={(e) => patch({ url: e.target.value })}
                      data-testid="ws-mqtt-url"
                    />
                  </label>
                  <label className="space-y-1.5">
                    <span className="block text-xs font-semibold text-gray-700 dark:text-gray-200">{t('water_supply.mqtt_source.username')}</span>
                    <input className={INPUT_CLS} value={form.username} onChange={(e) => patch({ username: e.target.value })} data-testid="ws-mqtt-username" />
                  </label>
                  <label className="space-y-1.5">
                    <span className="block text-xs font-semibold text-gray-700 dark:text-gray-200">{t('water_supply.mqtt_source.password')}</span>
                    <input
                      type="password"
                      className={INPUT_CLS}
                      value={form.password}
                      placeholder={saved?.password === BROKER_PASSWORD_MASK ? t('water_supply.mqtt_source.password_keep') : ''}
                      onFocus={() => form.password === BROKER_PASSWORD_MASK && patch({ password: '' })}
                      onBlur={() => !form.password && saved?.password === BROKER_PASSWORD_MASK && saved.url === form.url && patch({ password: BROKER_PASSWORD_MASK })}
                      onChange={(e) => patch({ password: e.target.value })}
                      data-testid="ws-mqtt-password"
                    />
                  </label>
                </div>
              )}

              {testResult && (
                <div
                  className={`rounded-lg px-3 py-2 text-xs ${testResult.ok ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-rose-500/10 text-rose-700 dark:text-rose-300'}`}
                  data-testid="ws-mqtt-test-result"
                >
                  {testResult.text}
                </div>
              )}

              <div className="flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  className={BTN_OUTLINE}
                  disabled={testing || !form.topic.trim() || (form.custom && !form.url.trim())}
                  onClick={handleTest}
                  data-testid="ws-mqtt-test"
                >
                  {testing ? t('water_supply.mqtt_source.testing') : t('water_supply.mqtt_source.test')}
                </button>
                <button type="button" className={BTN_SAVE} disabled={!canSave} onClick={handleSave} data-testid="ws-mqtt-save">
                  {saving ? t('water_supply.mqtt_source.saving') : t('water_supply.mqtt_source.save')}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

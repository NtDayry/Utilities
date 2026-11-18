// class ของ input / ปุ่ม ให้หน้าตาเหมือน InputField / Button ของหน้า settings (ใช้ element ปกติเพื่อส่ง data-testid / onFocus ได้)
export const INPUT_CLS =
  'h-11 w-full rounded-lg border appearance-none px-4 py-2.5 text-sm shadow-theme-xs placeholder:text-gray-400 focus:outline-hidden focus:ring-3 bg-transparent text-gray-800 border-gray-300 focus:border-brand-300 focus:ring-brand-500/20 dark:bg-gray-900 dark:border-gray-700 dark:text-white/90 dark:placeholder:text-white/30 dark:focus:border-brand-800 disabled:opacity-40 disabled:cursor-not-allowed disabled:bg-gray-100 dark:disabled:bg-gray-800';

export const INPUT_SM_CLS =
  'h-9 w-full rounded-lg border px-3 py-1.5 text-xs font-mono bg-transparent text-gray-800 border-gray-300 focus:outline-hidden focus:border-brand-300 focus:ring-2 focus:ring-brand-500/20 dark:bg-gray-900 dark:border-gray-700 dark:text-white/90 disabled:opacity-40';

export const BTN_SAVE =
  'inline-flex items-center justify-center gap-2 rounded-lg px-3 h-10 text-sm font-medium transition min-w-[90px] bg-success text-white shadow-theme-xs hover:bg-success-hover dark:bg-success/15 dark:text-success dark:ring-1 dark:ring-inset dark:ring-success/50 dark:hover:bg-success/30 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer';

export const BTN_OUTLINE =
  'inline-flex items-center justify-center gap-2 rounded-lg px-3 h-10 text-sm font-medium transition bg-white text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-700 dark:hover:bg-white/[0.03] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer';

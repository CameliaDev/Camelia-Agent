/**
 * Local wall-clock helpers for prompt injection.
 *
 * Models have a training cutoff and often invent "today". Camelia injects the
 * user's local date/time (default Asia/Shanghai) into system prompts so relative
 * dates ("this year", "yesterday") resolve correctly.
 * @module
 */

export const CAMELIA_DEFAULT_TZ = 'Asia/Shanghai';

/** Format an instant in a stable, LLM-friendly local form. */
export function formatLocalNow(nowMs: number = Date.now(), timeZone: string = CAMELIA_DEFAULT_TZ): string {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'shortOffset',
  });
  const parts = Object.fromEntries(dtf.formatToParts(new Date(nowMs)).map((p) => [p.type, p.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const time = `${parts.hour}:${parts.minute}:${parts.second}`;
  const offset = parts.timeZoneName ?? '';
  const weekday = parts.weekday ?? '';
  return `${weekday}, ${date} ${time} (${timeZone}${offset ? ', ' + offset : ''})`;
}

/** One system-prompt line the model can treat as ground truth for "now". */
export function localNowPromptLine(nowMs: number = Date.now(), timeZone: string = CAMELIA_DEFAULT_TZ): string {
  return (
    `Current local date/time: ${formatLocalNow(nowMs, timeZone)}. ` +
    'Treat this as authoritative for "today", "this year", weekdays, and relative dates — do not rely on your training cutoff.'
  );
}

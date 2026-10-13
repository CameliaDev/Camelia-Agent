/**
 * Failed-command notice — one line, every mode.
 *
 * This box used to be drawn inside the chat transcript, and that is why a failed pause in
 * plan or math looked like nothing had happened: the engine answered `{ ok: false }`, the
 * store recorded `lastCommandError`, and the only place that field was rendered was a
 * component chat alone mounts. The command was rejected *visibly nowhere*.
 *
 * It is rendered once by `App`, above the composer — near the controls whose failure it
 * reports, and in front of every mode.
 *
 * The message is the engine's own words (`type: error`), not a paraphrase: "当前没有运行中
 * 的任务" and "任务 tsk_x 没有待审批的计划" are different problems, and flattening them into
 * "操作失败" is what made the original report so hard to act on.
 * @module
 */

import type { ReactNode } from 'react';

import { t } from '../i18n/strings.js';
import { useUiStore } from '../state/UiProvider.js';

export function CommandErrorNotice(): ReactNode {
  const failure = useUiStore((s) => s.lastCommandError);
  const clearCommandError = useUiStore((s) => s.clearCommandError);
  const language = useUiStore((s) => s.localPrefs.language);
  const tr = (k: Parameters<typeof t>[1]) => t(language, k);

  if (!failure) return null;

  return (
    <div className="shrink-0 px-4 pb-2">
      <div
        role="status"
        className="mx-auto flex w-full max-w-3xl items-start gap-2 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-[12px] text-warn"
        data-command-error
      >
        <span className="min-w-0 flex-1 font-mono text-[11.5px]">
          {failure.type}: {failure.error}
        </span>
        <button
          type="button"
          className="shrink-0 text-[11px] underline"
          onClick={() => clearCommandError()}
        >
          {tr('commandError.dismiss')}
        </button>
      </div>
    </div>
  );
}
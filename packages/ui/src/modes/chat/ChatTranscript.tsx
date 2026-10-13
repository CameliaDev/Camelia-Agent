/**
 * ChatTranscript — the 对话 mode surface (direct conversation path).
 *
 * Renders `snapshot.chat` — the projection of the `chat.*` event family — as a
 * plain chat: user turns on the right, assistant turns on the left with inline
 * tool rows, a streaming caret while deltas are arriving, and an option picker
 * whenever the model asked a question (`chat.ask_user`). A chat turn never
 * creates a task, so nothing here touches the plan machinery; that is exactly
 * the difference from `Conversation`, which folds the task pipeline.
 * @module
 */

import { useEffect, useRef, type ReactNode } from 'react';

import type { ToolCallStatus } from '@camelia/core';
import type { ChatTurnView, ToolCallView } from '@camelia/agent/view';

import { t } from '../../i18n/strings.js';
import { makeCommand } from '../../state/store.js';
import { useUiState, useUiStore } from '../../state/UiProvider.js';
import { Icon } from '../../components/primitives.js';

/** Dot colour per tool status, mirroring the conversation's step tones. */
function toolDot(status: ToolCallStatus): string {
  if (status === 'ok') return 'bg-ok';
  if (status === 'error' || status === 'denied') return 'bg-bad';
  if (status === 'awaiting-approval') return 'bg-warn';
  if (status === 'running') return 'bg-info camelia-pulse';
  return 'bg-ink-3';
}

export function ChatTranscript(): ReactNode {
  const { snapshot, activeSessionId, dispatch } = useUiState();
  const lang = useUiStore((s) => s.localPrefs.language);
  const tr = (k: Parameters<typeof t>[1]) => t(lang, k);
  const chat = snapshot.chat;
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // jsdom (tests) has no layout engine — the optional call keeps tests honest.
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [chat.turns.length, chat.pendingAsk?.askId]);

  const answer = (idx: number): void => {
    if (!chat.pendingAsk) return;
    dispatch(
      makeCommand('chat_answer', {
        sessionId: activeSessionId ?? 'ses_new',
        askId: chat.pendingAsk.askId,
        optionIdx: idx,
      }),
    );
  };

  return (
    <div data-chat-transcript className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {chat.turns.length === 0 && !chat.pendingAsk ? (
        <div className="flex flex-1 items-center justify-center px-6">
          <p className="max-w-sm text-center text-[12.5px] leading-5 text-ink-3">{tr('chat.empty')}</p>
        </div>
      ) : (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-4">
          {chat.turns.map((turn) => (
            <ChatBubble key={turn.id} turn={turn} />
          ))}
          {chat.pendingAsk ? (
            <AskUserCard
              question={chat.pendingAsk.question}
              options={chat.pendingAsk.options}
              onAnswer={answer}
              label={tr('chat.askTitle')}
            />
          ) : null}
          <div ref={endRef} />
        </div>
      )}
    </div>
  );
}

function ChatBubble({ turn }: { turn: ChatTurnView }): ReactNode {
  if (turn.role === 'user') {
    return (
      <div className="flex justify-end" data-chat-user>
        <div className="wf-bubble-user max-w-[80%] px-3.5 py-2.5">
          <p className="whitespace-pre-wrap text-[13.5px] leading-6">{turn.text}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start" data-chat-assistant>
      <div className="wf-bubble-agent max-w-[85%] px-3.5 py-2.5">
        {turn.toolCalls.map((call) => (
          <ChatToolRow key={call.id} call={call} />
        ))}
        {turn.text ? <p className="whitespace-pre-wrap text-[13.5px] leading-6">{turn.text}</p> : null}
        {turn.streaming ? (
          <span className="camelia-pulse ml-0.5 inline-block h-3 w-1.5 translate-y-[1px] bg-accent align-middle" />
        ) : null}
        {turn.error ? (
          <p className="mt-1 flex items-center gap-1 text-[12px] text-bad">
            <Icon name="alert" size={12} className="shrink-0" />
            {turn.error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** One tool call, inline in the assistant turn — name, risk, status. */
function ChatToolRow({ call }: { call: ToolCallView }): ReactNode {
  return (
    <div
      data-chat-tool
      className="mb-1.5 flex items-center gap-1.5 rounded-lg border border-line bg-base/60 px-2 py-1 text-[11.5px] text-ink-2 last:mb-0"
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${toolDot(call.status)}`} />
      <span className="min-w-0 flex-1 truncate font-mono">{call.name}</span>
      <span className="shrink-0 rounded bg-hover px-1 py-0.5 text-[10px] text-ink-3">{call.risk}</span>
      <span className="shrink-0 font-mono text-[10.5px] text-ink-3">{call.status}</span>
    </div>
  );
}

/** The `chat.ask_user` picker: one question, fixed options, one tap to answer. */
function AskUserCard({
  question,
  options,
  onAnswer,
  label,
}: {
  question: string;
  options: string[];
  onAnswer: (idx: number) => void;
  label: string;
}): ReactNode {
  return (
    <div
      data-chat-ask
      className="mx-auto w-full max-w-md rounded-xl border border-accent/30 bg-accent/8 p-3"
      role="group"
      aria-label={label}
    >
      <p className="text-[12px] font-medium text-accent">{label}</p>
      <p className="mt-1 text-[13px] leading-5 text-ink">{question}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {options.map((option, idx) => (
          <button
            key={idx}
            type="button"
            data-chat-ask-option={idx}
            onClick={() => onAnswer(idx)}
            className="rounded-full border border-line bg-elevated px-3 py-1.5 text-[12px] text-ink transition-colors hover:border-accent/50 hover:bg-accent/12 hover:text-accent"
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

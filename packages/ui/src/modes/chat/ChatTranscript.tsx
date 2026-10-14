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
import { Avatar, Icon, userAvatarSrc } from '../../components/primitives.js';
import { providerAvatarSrc } from '../../lib/provider-avatars.js';
import { splitThinking } from '../../lib/thinking.js';
import { TaskRunCard } from '../../components/TaskRunCard.js';
import { CollapsibleBlock } from '../../components/CollapsibleBlock.js';
import { ms } from '../../lib/format.js';

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
  const task = snapshot.task;
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // jsdom (tests) has no layout engine — the optional call keeps tests honest.
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [chat.turns.length, chat.pendingAsk?.askId, task?.id, task?.status]);

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
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-3 px-4 py-4">
        {chat.turns.length === 0 && !chat.pendingAsk && !task ? (
          <div className="flex flex-1 items-center justify-center px-6" data-chat-empty>
            <p className="max-w-sm text-center text-[12.5px] leading-5 text-ink-3">{tr('chat.empty')}</p>
          </div>
        ) : null}
        {chat.turns.map((turn) => (
          <ChatBubble key={turn.id} turn={turn} />
        ))}
        <TaskRunCard />
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
    </div>
  );
}

function visibleAnswer(turn: ChatTurnView): string {
  return splitThinking(turn.text).answer;
}

/**
 * Reasoning text worth showing. A live turn with no text used to render the
 * status label as both the summary and the body — an empty 「思考中…」 box
 * under every tool card. The header already says that, so only real text
 * earns a block.
 */
function reasoningText(turn: ChatTurnView): string {
  const parts = splitThinking(turn.text);
  return [turn.thinking, parts.thinking]
    .map((part) => part?.trim() ?? '')
    .filter((part) => part.length > 0)
    .join('\n\n');
}

function ThinkingFold({ turn, label }: { turn: ChatTurnView; label: string }): ReactNode {
  if (turn.role !== 'assistant') return null;
  const parts = splitThinking(turn.text);
  const thinking = reasoningText(turn);
  if (!thinking) return null;
  const live = Boolean(turn.streaming && !parts.answer.trim());
  return (
    <div className={parts.answer ? 'mb-2' : undefined} data-chat-thinking={live ? 'live' : 'folded'}>
      {/*
        Stay collapsed, including while tools are still running. Opening every
        block as tokens arrive is what flooded the thread; the header carries
        the live status, and the row stays expandable.
      */}
      <CollapsibleBlock summary={label} preferOpen={false} defaultOpen={false} data-collapsible="thinking">
        <p className="whitespace-pre-wrap px-1 text-[12.5px] leading-5 text-ink-2">{thinking}</p>
      </CollapsibleBlock>
    </div>
  );
}

function ChatBubble({ turn }: { turn: ChatTurnView }): ReactNode {
  const showAvatars = useUiStore((s) => s.localPrefs.showAvatars);
  const userAvatar = useUiStore((s) => s.localPrefs.userAvatar);
  const githubAccount = useUiStore((s) => s.localPrefs.githubAccount);
  const lang = useUiStore((s) => s.localPrefs.language);
  const activeProvider = useUiStore((s) => s.snapshot.provider.activeProvider);
  const tr = (k: Parameters<typeof t>[1]) => t(lang, k);

  if (turn.role === 'user') {
    return (
      <div className="flex items-end justify-end gap-2" data-chat-user data-message="user">
        <div className="wf-bubble-user max-w-[80%] px-3.5 py-2.5">
          {turn.images?.length ? (
            <div className="mb-2 flex flex-wrap gap-1.5" data-chat-images>
              {turn.images.map((img, i) => (
                <img
                  key={i}
                  src={`data:${img.mimeType};base64,${img.dataBase64}`}
                  alt=""
                  className="max-h-40 max-w-full rounded-lg border border-white/20 object-contain"
                />
              ))}
            </div>
          ) : null}
          {turn.text ? <p className="whitespace-pre-wrap text-[13.5px] leading-6">{turn.text}</p> : null}
        </div>
        {showAvatars ? (
          <Avatar kind="user" size={32} title={tr('avatar.user')} src={userAvatarSrc(userAvatar, githubAccount)} />
        ) : null}
      </div>
    );
  }
  return (
    <div className="flex items-end justify-start gap-2" data-chat-assistant data-message="assistant">
      {showAvatars ? (
        <Avatar
          kind="agent"
          size={32}
          title={tr('avatar.agent')}
          src={providerAvatarSrc(activeProvider)}
        />
      ) : null}
      <div className="wf-bubble-agent max-w-[85%] px-3.5 py-2.5">
        {turn.toolCalls.map((call) => (
          <ChatToolRow key={call.id} call={call} />
        ))}
        <ThinkingFold turn={turn} label={tr('chat.thinking')} />
        {visibleAnswer(turn) ? (
          <p className="whitespace-pre-wrap text-[13.5px] leading-6">{visibleAnswer(turn)}</p>
        ) : null}
        {turn.streaming && visibleAnswer(turn) ? (
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
  const summary = (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${toolDot(call.status)}`} />
      <span className="truncate font-mono">{call.name}</span>
      {call.durationMs !== undefined ? <span className="text-ink-3">{ms(call.durationMs)}</span> : null}
      <span className="text-ink-3">{call.status}</span>
    </span>
  );
  return (
    <div data-chat-tool className="mb-1.5 last:mb-0">
      <CollapsibleBlock summary={summary} data-collapsible="tool">
        <div className="flex items-center gap-1.5 rounded-lg border border-line bg-base/60 px-2 py-1 text-[11.5px] text-ink-2">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${toolDot(call.status)}`} />
          <span className="min-w-0 flex-1 truncate font-mono">{call.name}</span>
          <span className="shrink-0 rounded bg-hover px-1 py-0.5 text-[10px] text-ink-3">{call.risk}</span>
          <span className="shrink-0 font-mono text-[10.5px] text-ink-3">{call.status}</span>
        </div>
      </CollapsibleBlock>
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

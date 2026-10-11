/**
 * Status → presentation vocabulary.
 *
 * Kept apart from the components so the mapping from engine state to pixels is a single
 * reviewable table. If a status is missing here, the compiler says so — which is how we
 * keep the UI from silently dropping a state the engine can produce.
 * @module
 */

import type { RiskLevel, StepStatus, TaskPhase, ToolCallStatus } from '@camelia/core';
import type { ActivityKind, ApprovalState, NoticeView } from '@camelia/agent/view';

export type Tone = 'ok' | 'bad' | 'warn' | 'info' | 'accent' | 'muted';

export interface Meta {
  label: string;
  tone: Tone;
}

export const STEP_META: Record<StepStatus, Meta> = {
  pending: { label: 'Pending', tone: 'muted' },
  running: { label: 'Running', tone: 'accent' },
  verifying: { label: 'Verifying', tone: 'info' },
  done: { label: 'Done', tone: 'ok' },
  failed: { label: 'Failed', tone: 'bad' },
  skipped: { label: 'Skipped', tone: 'muted' },
};

export const PHASE_META: Record<TaskPhase, Meta> = {
  idle: { label: 'Idle', tone: 'muted' },
  planning: { label: 'Planning', tone: 'accent' },
  'awaiting-approval': { label: 'Awaiting approval', tone: 'warn' },
  executing: { label: 'Executing', tone: 'accent' },
  verifying: { label: 'Verifying', tone: 'info' },
  delivering: { label: 'Delivering', tone: 'ok' },
  paused: { label: 'Paused', tone: 'warn' },
};

export const ACTIVITY_META: Record<ActivityKind, Meta> = {
  idle: { label: 'Idle', tone: 'muted' },
  planning: { label: 'Planning', tone: 'accent' },
  executing: { label: 'Executing', tone: 'accent' },
  verifying: { label: 'Verifying', tone: 'info' },
  delivering: { label: 'Delivering', tone: 'ok' },
  'waiting-approval': { label: 'Waiting for you', tone: 'warn' },
};

export const TOOL_STATUS_META: Record<ToolCallStatus, Meta> = {
  pending: { label: 'Queued', tone: 'muted' },
  'awaiting-approval': { label: 'Awaiting approval', tone: 'warn' },
  approved: { label: 'Approved', tone: 'info' },
  denied: { label: 'Denied', tone: 'bad' },
  running: { label: 'Running', tone: 'accent' },
  ok: { label: 'OK', tone: 'ok' },
  error: { label: 'Error', tone: 'bad' },
};

export const RISK_META: Record<RiskLevel, Meta> = {
  'read-only': { label: 'read-only', tone: 'muted' },
  write: { label: 'write', tone: 'info' },
  destructive: { label: 'destructive', tone: 'bad' },
  network: { label: 'network', tone: 'warn' },
  privileged: { label: 'privileged', tone: 'warn' },
};

export const APPROVAL_META: Record<ApprovalState, Meta> = {
  none: { label: 'auto', tone: 'muted' },
  required: { label: 'needs you', tone: 'warn' },
  approved: { label: 'approved', tone: 'ok' },
  denied: { label: 'denied', tone: 'bad' },
};

export const NOTICE_META: Record<NoticeView['kind'], { label: string; tone: Tone; icon: string }> = {
  drift: { label: 'Goal drift', tone: 'warn', icon: 'compass' },
  loop: { label: 'Loop broken', tone: 'warn', icon: 'repeat' },
  hallucination: { label: 'Unsupported claim', tone: 'bad', icon: 'shield' },
  'no-progress': { label: 'No progress', tone: 'warn', icon: 'pause' },
  rollback: { label: 'Recovery', tone: 'ok', icon: 'undo' },
};

export const CONNECTION_META: Record<'connecting' | 'live' | 'finished' | 'offline', Meta> = {
  connecting: { label: 'Connecting', tone: 'warn' },
  live: { label: 'Live', tone: 'accent' },
  finished: { label: 'Finished', tone: 'ok' },
  offline: { label: 'Offline', tone: 'muted' },
};

/** Tailwind classes per tone — the one place tone becomes colour. */
export const TONE_TEXT: Record<Tone, string> = {
  ok: 'text-ok',
  bad: 'text-bad',
  warn: 'text-warn',
  info: 'text-info',
  accent: 'text-accent',
  muted: 'text-ink-3',
};

export const TONE_BG: Record<Tone, string> = {
  ok: 'bg-ok/12 text-ok border-ok/25',
  bad: 'bg-bad/12 text-bad border-bad/25',
  warn: 'bg-warn/12 text-warn border-warn/25',
  info: 'bg-info/12 text-info border-info/25',
  accent: 'bg-accent/12 text-accent border-accent/25',
  muted: 'bg-hover/60 text-ink-3 border-line',
};

export const TONE_DOT: Record<Tone, string> = {
  ok: 'bg-ok',
  bad: 'bg-bad',
  warn: 'bg-warn',
  info: 'bg-info',
  accent: 'bg-accent',
  muted: 'bg-ink-3',
};
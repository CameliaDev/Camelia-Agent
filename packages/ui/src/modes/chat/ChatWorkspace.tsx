/**
 * Conversation mode.
 *
 * The default surface and the original product path: the running record of the task, with
 * the activity bar above it. This module is a thin wrapper — the conversation body is
 * still `components/Conversation.tsx`, unchanged in behaviour.
 *
 * It exists because chat and plan now diverge at the *workspace* level (plan mode gets the
 * plan review as its primary surface), while both still read the same projection. Keeping
 * the wrapper explicit is what lets `ModeShell` stay a one-line dispatch.
 * @module
 */

import { type ReactNode } from 'react';

import { Conversation } from '../../components/Conversation.js';

export function ChatWorkspace(): ReactNode {
  return <Conversation />;
}

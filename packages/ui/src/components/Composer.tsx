/**
 * Composer (bottom bar) — one input, two meanings.
 *
 * With no active task it submits a new task; while a task is running it steers the
 * existing goal. That mapping stays explicit, because "what will happen if I press enter"
 * should never be ambiguous:
 *
 * | state   | control                        | sends            |
 * |---------|--------------------------------|------------------|
 * | idle    | rounded send, arrow up         | `submit_task`    |
 * | running | labelled pill, 「引导」/「Steer」| `intervene_goal` |
 *
 * The idle form is a bare icon on purpose: it is the shape every chat app has already
 * taught, and there is nothing to disambiguate when no run is in flight. The running form
 * keeps its word, because a second submit would *not* be a new task and no glyph can say
 * that. The line under the card carries the keyboard contract instead of the button.
 *
 * ## Disabled is neutral, not faded
 *
 * Both controls go flat grey when they cannot act rather than being drawn at partial
 * opacity. Fading the whole button fades the glyph with it, which collapses the gap
 * between glyph and fill — measured, the running pill's label dropped to 1.81:1, so the
 * control read as broken instead of unavailable. A specified neutral fill states
 * "unavailable" once, and keeps the label legible while it does.
 *
 * ## What is in this bar
 *
 * Clipboard paste still attaches images. The `+` button uses the same path. There is
 * no microphone and no plugin cluster: those would be controls that cannot act.
 *
 * The model chip switches the model in place. A provider that advertises one model,
 * or none after a failed model list, still opens this picker: the known catalog and
 * a typed id are enough. Switching model must not silently switch vendor.
 *
 * Effort sits next to the model. Work mode also has the permission chip. Work, Math,
 * and Term live above the session list, not in this card.
 * @module
 */

import { useCallback, useEffect, useId, useRef, useState, type ClipboardEvent, type DragEvent, type ReactNode } from 'react';

import type { ChatPolicy } from '@camelia/core';

import { composerModelChoices, describeModelChoice, modelPassesFilter, type ModelFilter } from '../lib/composer-models.js';
import { projectionMatchesMode } from '../mode/session-kind.js';
import { makeCommand } from '../state/store.js';
import { setMathProfile } from '../state/shell-extras.js';
import { useUiState, useUiStore, useUiStoreApi } from '../state/UiProvider.js';
import { t } from '../i18n/strings.js';
import { useMode } from '../mode/useMode.js';
import { Icon } from './primitives.js';

/** The permission postures a chat turn can run under — order is the picker's order. */
const CHAT_POLICIES: readonly ChatPolicy[] = ['readonly-sandbox', 'ask', 'full'];

/** One clipboard image waiting to ride with the next Work chat turn. */
interface PendingImage {
  id: string;
  mimeType: string;
  dataUrl: string;
  /** Raw base64 without the data: prefix — what chat_message carries. */
  dataBase64: string;
}

/** One folder waiting to ride with the next Work turn. */
interface PendingFolder {
  id: string;
  name: string;
  path?: string;
}

const MAX_PENDING_FOLDERS = 8;
const MAX_PENDING_IMAGES = 4;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif']);

function normalizeMime(mime: string): string {
  return mime === 'image/jpg' ? 'image/jpeg' : mime;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.readAsDataURL(file);
  });
}

interface DirectoryEntryLike {
  isDirectory: boolean;
  name: string;
  fullPath?: string;
}

function hostPath(file: File | null): string | undefined {
  if (!file) return undefined;
  const candidate = (file as File & { path?: unknown }).path;
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : undefined;
}

function folderFromItem(item: DataTransferItem): { name: string; path?: string } | undefined {
  const entry = (item as DataTransferItem & { webkitGetAsEntry?: () => DirectoryEntryLike | null }).webkitGetAsEntry?.();
  if (!entry?.isDirectory) return undefined;
  const name = entry.name?.trim();
  if (!name || name === '.' || name === '..') return undefined;
  const path = hostPath(item.getAsFile()) ?? (entry.fullPath?.trim() || undefined);
  return path ? { name, path } : { name };
}

function splitPlanText(text: string): { goal: string; constraints: string[]; body: string } {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const constraints: string[] = [];
  const rest: string[] = [];
  for (const line of lines) {
    const marked = /^(?:constraint|约束)\s*[:：]\s*(.+)$/i.exec(line);
    if (marked?.[1]) constraints.push(marked[1]);
    else rest.push(line);
  }
  return { goal: rest[0] ?? text.trim(), constraints, body: text.trim() };
}

function policyLabelKey(policy: ChatPolicy): 'composer.policy.readonly' | 'composer.policy.ask' | 'composer.policy.full' {
  return policy === 'full'
    ? 'composer.policy.full'
    : policy === 'ask'
      ? 'composer.policy.ask'
      : 'composer.policy.readonly';
}

export function Composer({ centered = false }: { centered?: boolean } = {}): ReactNode {
  const { snapshot, activeSessionId, status, dispatch } = useUiState();
  const store = useUiStoreApi();
  const lang = useUiStore((s) => s.localPrefs.language);
  const tr = (k: Parameters<typeof t>[1]) => t(lang, k);
  const [value, setValue] = useState('');
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [pendingFolders, setPendingFolders] = useState<PendingFolder[]>([]);
  const [dropActive, setDropActive] = useState(false);
  const [imageNotice, setImageNotice] = useState<string | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imageIdPrefix = useId();
  const task = snapshot.task;
  const running = task !== undefined && task.status !== 'done' && task.status !== 'failed' && task.status !== 'cancelled';
  const { mode } = useMode();
  const conversational = mode === 'work' || mode === 'math';
  const chatPolicy = useUiStore((s) => s.localPrefs.chatPolicy);
  const effort = useUiStore((s) => s.localPrefs.effort);
  const setLocalPrefs = useUiStore((s) => s.setLocalPrefs);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [teams, setTeams] = useState<{ id: string; name: string; members: { role: string; model: string }[] }[]>([]);
  const teamRef = useRef<HTMLDivElement>(null);
  const policyRef = useRef<HTMLDivElement>(null);
  const postureBox =
    'inline-flex items-center rounded-full border border-line px-2 py-[3px] text-[10.5px] font-medium text-ink-2 hover:bg-hover hover:text-ink';
  const postureBoxActive = 'border-accent/35 bg-accent/12 text-accent';

  useEffect(() => {
    if (!policyOpen) return;
    const onDown = (event: MouseEvent): void => {
      if (policyRef.current && !policyRef.current.contains(event.target as Node)) setPolicyOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setPolicyOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [policyOpen]);

  useEffect(() => {
    if (!teamOpen) return;
    const onDown = (event: MouseEvent): void => {
      if (teamRef.current && !teamRef.current.contains(event.target as Node)) setTeamOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setTeamOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [teamOpen]);

  /**
   * Grow the field with the text rather than showing a scrollbar after the first line.
   *
   * `height: auto` first, or shrinking is impossible: `scrollHeight` measured against the
   * previous height would only ever ratchet upward.
   */
  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    area.style.height = 'auto';
    area.style.height = `${area.scrollHeight}px`;
  }, [value]);

  /** Same line the rail's profile stack shows, so the two can never disagree. */
  const providerLine = snapshot.provider.activeProvider
    ? `${snapshot.provider.activeProvider} · ${snapshot.provider.activeModel}`
    : status === 'connecting'
      ? tr('provider.connecting')
      : tr('provider.none');

  /**
   * In-place model switching.
   *
   * The chip always opens a picker when a provider is connected. Advertised ids,
   * the preset catalog, and a typed id are one list. A list tagged for another
   * vendor is ignored so this control cannot switch provider. Settings is not
   * the fallback when `/models` comes back empty.
   */
  const provider = snapshot.provider.activeProvider;
  const models = snapshot.provider.models ?? [];
  const modelDetails = snapshot.provider.modelDetails ?? [];
  const detailById = new Map(modelDetails.map((d) => [d.id, d]));
  const activeModel = snapshot.provider.activeModel;
  const choices = composerModelChoices({
    providerId: provider,
    activeModel,
    advertised: models,
    advertisedFor: snapshot.provider.modelsFor,
  });
  const [modelFilter, setModelFilter] = useState<ModelFilter>('all');
  const visibleChoices = choices.filter((model) =>
    modelPassesFilter(
      describeModelChoice({ id: model, providerId: provider, advertised: detailById.get(model) }),
      modelFilter,
    ),
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [manualModel, setManualModel] = useState('');
  const [effortOpen, setEffortOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const effortRef = useRef<HTMLDivElement>(null);
  const manualRef = useRef<HTMLInputElement>(null);

  const chooseModel = (model: string): void => {
    const id = model.trim();
    if (!provider || !id) return;
    dispatch(makeCommand('select_provider', { providerId: provider, model: id }));
    setPickerOpen(false);
    setManualModel('');
  };

  useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (event: MouseEvent): void => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) setPickerOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setPickerOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [pickerOpen]);

  useEffect(() => {
    if (!effortOpen) return;
    const onDown = (event: MouseEvent): void => {
      if (effortRef.current && !effortRef.current.contains(event.target as Node)) setEffortOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setEffortOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [effortOpen]);

  useEffect(() => {
    if (pickerOpen && choices.length === 0) manualRef.current?.focus();
  }, [pickerOpen, choices.length]);

  const addImageFiles = useCallback(
    async (files: File[]): Promise<void> => {
      if (files.length === 0) return;
      const next: PendingImage[] = [];
      let notice: string | null = null;
      for (const file of files) {
        const mime = normalizeMime(file.type || 'image/png');
        if (!ALLOWED_MIME.has(mime)) continue;
        if (file.size > MAX_IMAGE_BYTES) {
          notice = 'composer.imageTooLarge';
          continue;
        }
        if (pendingImages.length + next.length >= MAX_PENDING_IMAGES) {
          notice = 'composer.imageLimit';
          break;
        }
        try {
          const dataUrl = await readFileAsDataUrl(file);
          const comma = dataUrl.indexOf(',');
          const dataBase64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
          if (!dataBase64) continue;
          next.push({
            id: `${imageIdPrefix}-${Date.now()}-${next.length}`,
            mimeType: mime,
            dataUrl,
            dataBase64,
          });
        } catch {
          // Skip unreadable clipboard blobs.
        }
      }
      if (next.length) setPendingImages((prev) => [...prev, ...next].slice(0, MAX_PENDING_IMAGES));
      if (notice) setImageNotice(notice);
      else if (next.length) setImageNotice(null);
    },
    [imageIdPrefix, pendingImages.length],
  );

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>): void => {
    const items = event.clipboardData?.items;
    if (!items?.length) return;
    const files: File[] = [];
    for (const item of items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length === 0) return;
    event.preventDefault();
    void addImageFiles(files);
  };

  const removeImage = (id: string): void => {
    setPendingImages((prev) => prev.filter((img) => img.id !== id));
    setImageNotice(null);
  };

  const addDroppedFolders = (data: DataTransfer | null): void => {
    if (!data || mode !== 'work') return;
    const found: { name: string; path?: string }[] = [];
    const items = data.items;
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (!item) continue;
      const folder = folderFromItem(item);
      if (folder) found.push(folder);
    }
    if (found.length === 0) return;
    setPendingFolders((prev) => {
      const next = [...prev];
      for (const folder of found) {
        if (next.length >= MAX_PENDING_FOLDERS) {
          setImageNotice('composer.folderLimit');
          break;
        }
        if (next.some((row) => row.name === folder.name && row.path === folder.path)) continue;
        next.push({ id: `${imageIdPrefix}-folder-${next.length}-${folder.name}`, ...folder });
      }
      return next;
    });
  };

  const onFolderDragOver = (event: DragEvent<HTMLDivElement>): void => {
    if (mode !== 'work') return;
    const types = event.dataTransfer?.types;
    const hasFiles = types ? Array.from(types).includes('Files') : false;
    if (!hasFiles) return;
    event.preventDefault();
    setDropActive(true);
  };

  const onFolderDrop = (event: DragEvent<HTMLDivElement>): void => {
    if (mode !== 'work') return;
    event.preventDefault();
    setDropActive(false);
    addDroppedFolders(event.dataTransfer);
  };

  const submitTermRun = (intent: string): void => {
    const state = store.getState();
    const workspace = state.snapshot.session?.workspace ?? '.';
    const send = (sessionId: string): void => {
      state.dispatch(
        makeCommand('submit_term', {
          sessionId,
          intent,
          workspace,
          effort,
          ...(selectedTeamId ? { teamId: selectedTeamId } : {}),
        }),
      );
    };
    if (projectionMatchesMode(state.snapshot, 'term') && state.snapshot.session) {
      send(state.snapshot.session.id);
      return;
    }
    void state
      .query<{ sessionId: string }>(makeCommand('new_session', { kind: 'term' }))
      .then((res) => {
        if (!res?.sessionId) return;
        state.setActiveSession(res.sessionId);
        state.dispatch(makeCommand('select_session', { sessionId: res.sessionId }));
        send(res.sessionId);
      })
      .catch(() => undefined);
  };

  const posture = snapshot.work?.posture ?? 'chat';
  const folderPayload = pendingFolders.map((folder) => (folder.path ? { name: folder.name, path: folder.path } : { name: folder.name }));
  const folderNote = folderPayload.length
    ? `\n\nAttached folders:\n${folderPayload.map((folder) => `- ${folder.name}${folder.path ? ` (${folder.path})` : ''}`).join('\n')}`
    : '';

  const clearDraft = (): void => {
    setValue('');
    setPendingImages([]);
    setPendingFolders([]);
  };

  const submit = (): void => {
    const intent = value.trim();
    if (mode === 'work' && posture !== 'chat' && !running && !selectedTeamId) {
      const body = `${intent}${folderNote}`.trim();
      if (!body) return;
      const parsed = splitPlanText(intent || pendingFolders[0]?.name || body);
      const sessionId = snapshot.session?.id ?? activeSessionId ?? 'ses_new';
      dispatch(
        makeCommand('save_work_plan', {
          sessionId,
          mode: posture,
          title: parsed.goal.slice(0, 72),
          goal: parsed.goal,
          constraints: parsed.constraints,
          body,
        }),
      );
      clearDraft();
      return;
    }
    if (mode === 'work' && selectedTeamId && !running) {
      const teamIntent = `${intent}${folderNote}`.trim();
      if (!teamIntent) return;
      submitTermRun(teamIntent);
      clearDraft();
      return;
    }
    if (mode === 'term') {
      if (!intent) return;
      submitTermRun(intent);
      clearDraft();
      return;
    }
    const images =
      conversational && pendingImages.length > 0
        ? pendingImages.map((img) => ({ mimeType: img.mimeType, dataBase64: img.dataBase64 }))
        : undefined;
    if (!intent && !(images && images.length) && folderPayload.length === 0) return;
    if (conversational) {
      // 对话 mode: multimodal when images are pasted — OpenAI-compatible vision parts.
      // A foreign session (Work chat still projected under Math) gets its own row first.
      const state = store.getState();
      const current = state.snapshot.session;
      const foreign =
        Boolean(current) &&
        (current!.id.startsWith('pending_') || !projectionMatchesMode(state.snapshot, mode));
      const send = (sessionId: string): void => {
        state.dispatch(
          makeCommand('chat_message', {
            sessionId,
            text: intent,
            policy: chatPolicy,
            effort,
            ...(images?.length ? { images } : {}),
            ...(mode === 'work' && folderPayload.length ? { folders: folderPayload } : {}),
          }),
        );
      };
      if (!foreign) {
        send(current?.id ?? activeSessionId ?? 'ses_new');
      } else {
        const kind = mode === 'math' ? 'math' : 'work';
        void state
          .query<{ sessionId: string }>(makeCommand('new_session', { kind }))
          .then((res) => {
            if (!res?.sessionId) return;
            if (kind === 'math') setMathProfile(res.sessionId, { contest: 'cumcm', useTemplates: true });
            state.setActiveSession(res.sessionId);
            state.dispatch(makeCommand('select_session', { sessionId: res.sessionId }));
            send(res.sessionId);
          })
          .catch(() => undefined);
      }
    } else if (running && task) {
      if (!intent) return;
      dispatch(makeCommand('intervene_goal', { taskId: task.id, instruction: intent }));
    } else {
      if (!intent) return;
      dispatch(
        makeCommand('submit_task', {
          sessionId: activeSessionId ?? 'ses_new',
          intent,
          workspace: snapshot.session?.workspace ?? '.',
          effort,
        }),
      );
    }
    clearDraft();
    setImageNotice(!conversational && pendingImages.length > 0 ? 'composer.imagesWorkOnly' : null);
  };

  return (
    <footer
      data-composer-placement={centered ? 'centered' : 'docked'}
      className={centered ? 'w-full shrink-0 bg-transparent px-0 pb-0 pt-0' : 'shrink-0 bg-base px-4 pb-2.5 pt-3'}
    >
      <form
        className="mx-auto flex w-full max-w-3xl flex-col gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div
          data-composer
          data-composer-drop={dropActive ? 'active' : undefined}
          onDragOver={onFolderDragOver}
          onDragLeave={(event) => {
            if (event.currentTarget.contains(event.relatedTarget as Node)) return;
            setDropActive(false);
          }}
          onDrop={onFolderDrop}
          className={`flex flex-col gap-1.5 rounded-2xl border bg-elevated p-2.5 shadow-sm transition-colors focus-within:border-line ${
            dropActive ? 'border-accent' : 'border-line/60'
          }`}
        >
          {pendingImages.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 px-0.5" data-composer-images>
              {pendingImages.map((img) => (
                <div key={img.id} className="relative" data-composer-image={img.id}>
                  <img
                    src={img.dataUrl}
                    alt=""
                    className="h-16 w-16 rounded-lg border border-line object-cover"
                  />
                  <button
                    type="button"
                    data-composer-image-remove={img.id}
                    aria-label={tr('composer.removeImage')}
                    title={tr('composer.removeImage')}
                    onClick={() => removeImage(img.id)}
                    className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full border border-line bg-elevated text-[11px] text-ink shadow hover:bg-bad hover:text-white"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          {pendingFolders.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 px-0.5" data-composer-folders>
              {pendingFolders.map((folder) => (
                <div
                  key={folder.id}
                  data-composer-folder={folder.name}
                  className="flex items-center gap-1 rounded-lg border border-line bg-base px-2 py-1"
                >
                  <Icon name="folder" size={12} className="shrink-0 text-ink-3" />
                  <span className="max-w-[10rem] truncate text-[11.5px] text-ink">{folder.name}</span>
                  <button
                    type="button"
                    data-composer-folder-remove={folder.name}
                    aria-label={tr('composer.removeFolder')}
                    title={tr('composer.removeFolder')}
                    onClick={() => setPendingFolders((prev) => prev.filter((row) => row.id !== folder.id))}
                    className="text-[12px] text-ink-3 hover:text-bad"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          {dropActive ? (
            <p className="px-0.5 text-[10.5px] text-ink-3" data-composer-drop-hint>
              {tr('composer.dropFolder')}
            </p>
          ) : null}
          {imageNotice ? (
            <p className="px-0.5 text-[10.5px] text-warn" data-composer-image-notice>
              {tr(imageNotice as Parameters<typeof t>[1])}
            </p>
          ) : null}
          <textarea
            ref={areaRef}
            rows={2}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onPaste={onPaste}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={tr(
              mode === 'math'
                ? 'math.composer.placeholder'
                : mode === 'term'
                  ? 'term.composer'
                  : mode === 'work' && selectedTeamId
                    ? 'term.composer'
                  : mode === 'work' && posture === 'plan'
                    ? 'work.plan.placeholder'
                    : mode === 'work' && posture === 'goal'
                      ? 'work.goal.placeholder'
                      : mode === 'work'
                        ? 'composer.chatPlaceholder'
                        : running
                        ? 'composer.steerPlaceholder'
                        : 'composer.placeholder',
            )}
            className="max-h-60 min-h-[56px] w-full resize-none bg-transparent px-1.5 py-1 text-[14px] leading-6 text-ink outline-none placeholder:text-ink-3"
          />

          <div className="flex flex-wrap items-center gap-1.5 px-0.5" data-composer-toolbar>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              className="hidden"
              data-composer-attach-input
              onChange={(event) => {
                const files = [...(event.target.files ?? [])];
                event.target.value = '';
                void addImageFiles(files);
              }}
            />
            <button
              type="button"
              data-composer-attach
              aria-label={tr('composer.attach')}
              title={tr('composer.attach')}
              className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-ink-2 hover:bg-hover hover:text-ink"
              onClick={() => fileRef.current?.click()}
            >
              <Icon name="plus" size={15} />
            </button>
            {/*
              The chat permission picker, only in 对话 mode: it decides what a tool call
              inside a chat turn may do. Same listbox shape as the model chip, same
              outside-click contract, and the choice persists window-locally.
            */}
            {mode === 'work' ? (
              <div className="flex shrink-0 items-center gap-0.5" role="group" aria-label={tr('work.posture.plan')} data-work-posture={posture}>
                {(['chat', 'plan', 'goal'] as const).map((id) => (
                  <button
                    key={id}
                    type="button"
                    data-work-posture-tab={id}
                    aria-pressed={posture === id}
                    onClick={() => dispatch(makeCommand('set_work_posture', { posture: id }))}
                    className={`${postureBox} ${posture === id ? postureBoxActive : ''}`}
                  >
                    {tr(`work.posture.${id}` as Parameters<typeof t>[1])}
                  </button>
                ))}
              </div>
            ) : null}
            {mode === 'work' && !running ? (
              <div ref={teamRef} className="relative shrink-0">
                <button
                  type="button"
                  data-composer-team
                  aria-haspopup="listbox"
                  aria-expanded={teamOpen}
                  title={tr('composer.team')}
                  onClick={() => {
                    setTeamOpen((open) => !open);
                    void store
                      .getState()
                      .query<{ id: string; name: string; members: { role: string; model: string }[] }[]>(
                        makeCommand('list_teams', {}),
                      )
                      .then((rows) => setTeams(rows ?? []))
                      .catch(() => setTeams([]));
                  }}
                  className={`${postureBox} gap-1 ${selectedTeamId ? postureBoxActive : ''}`}
                >
                  <Icon name="bot" size={12} className="shrink-0" />
                  <span className="max-w-[96px] truncate">
                    {teams.find((team) => team.id === selectedTeamId)?.name ?? tr('composer.team')}
                  </span>
                  <Icon name="chevron" size={11} className={`shrink-0 text-ink-3 ${teamOpen ? '-rotate-90' : 'rotate-90'}`} />
                </button>
                {teamOpen ? (
                  <ul
                    role="listbox"
                    data-composer-teams
                    className="absolute bottom-full left-0 z-30 mb-1 min-w-[200px] rounded-lg border border-line bg-elevated p-1 shadow-lg"
                  >
                    <li>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11.5px] text-ink-2 hover:bg-hover"
                        onClick={() => {
                          setSelectedTeamId(null);
                          setTeamOpen(false);
                        }}
                      >
                        {tr('composer.teamOff')}
                      </button>
                    </li>
                    {teams.map((team) => (
                      <li key={team.id}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={team.id === selectedTeamId}
                          className={`flex w-full flex-col rounded-md px-2 py-1.5 text-left text-[11.5px] ${
                            team.id === selectedTeamId ? 'bg-accent/12 font-medium text-accent' : 'text-ink-2 hover:bg-hover'
                          }`}
                          onClick={() => {
                            setSelectedTeamId(team.id);
                            setTeamOpen(false);
                          }}
                        >
                          <span>{team.name}</span>
                          <span className="text-[10px] text-ink-3">
                            {team.members.map((member) => member.role).join(' · ')}
                          </span>
                        </button>
                      </li>
                    ))}
                    <li className="border-t border-line/80 pt-1">
                      <button
                        type="button"
                        className="flex w-full rounded-md px-2 py-1.5 text-left text-[11.5px] text-ink-2 hover:bg-hover"
                        onClick={() => {
                          const name = window.prompt(tr('composer.teamNamePrompt'), tr('composer.teamDefaultName'));
                          if (!name?.trim()) return;
                          const modelA = window.prompt(tr('composer.teamModelPrompt'), 'model-a');
                          const modelB = window.prompt(tr('composer.teamModelPrompt'), 'model-b');
                          if (!modelA?.trim() || !modelB?.trim()) return;
                          void store
                            .getState()
                            .query(makeCommand('save_team', {
                              name: name.trim(),
                              members: [
                                { role: 'coordinator', model: modelA.trim() },
                                { role: 'worker', model: modelB.trim() },
                              ],
                            }))
                            .then((team) => {
                              if (!team || typeof team !== 'object' || !('id' in team)) return;
                              const id = String((team as { id: string }).id);
                              setSelectedTeamId(id);
                              setTeams((prev) => [{ id, name: name.trim(), members: [] }, ...prev]);
                              setTeamOpen(false);
                            })
                            .catch(() => undefined);
                        }}
                      >
                        {tr('composer.teamCreate')}
                      </button>
                    </li>
                  </ul>
                ) : null}
              </div>
            ) : null}
            {conversational ? (
              <div ref={policyRef} className="relative shrink-0">
                <button
                  type="button"
                  data-composer-policy
                  aria-haspopup="listbox"
                  aria-expanded={policyOpen}
                  onClick={() => setPolicyOpen((open) => !open)}
                  title={tr('composer.policy')}
                  className={`flex items-center gap-1 rounded-full px-2 py-1 text-[11.5px] ${
                    policyOpen ? 'bg-accent/12 text-accent' : 'text-ink-2 hover:bg-hover hover:text-ink'
                  }`}
                >
                  <Icon name="shield" size={12} className="shrink-0" />
                  <span className="max-w-[110px] truncate">{tr(policyLabelKey(chatPolicy))}</span>
                  <Icon name="chevron" size={11} className={`shrink-0 text-ink-3 ${policyOpen ? '-rotate-90' : 'rotate-90'}`} />
                </button>

                {policyOpen ? (
                  <ul
                    role="listbox"
                    data-composer-policies
                    aria-label={tr('composer.policy')}
                    className="absolute bottom-full left-0 z-30 mb-1 min-w-[190px] rounded-lg border border-line bg-elevated p-1 shadow-lg"
                  >
                    {CHAT_POLICIES.map((policy) => {
                      const selected = policy === chatPolicy;
                      return (
                        <li key={policy}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={selected}
                            data-policy-option={policy}
                            onClick={() => {
                              setLocalPrefs({ chatPolicy: policy });
                              setPolicyOpen(false);
                            }}
                            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11.5px] ${
                              selected ? 'bg-accent/12 font-medium text-accent' : 'text-ink-2 hover:bg-hover hover:text-ink'
                            }`}
                          >
                            <span className="min-w-0 flex-1 truncate">{tr(policyLabelKey(policy))}</span>
                            {selected ? <Icon name="check" size={11} className="shrink-0" /> : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>
            ) : null}

            <span className="flex-1" />

            <div ref={pickerRef} className="relative min-w-0 max-w-[42%]">
              <button
                type="button"
                data-composer-model
                aria-haspopup={provider ? 'listbox' : undefined}
                aria-expanded={provider ? pickerOpen : undefined}
                onClick={() => {
                  if (!provider) return;
                  setPickerOpen((open) => !open);
                }}
                title={tr('composer.switchModel')}
                aria-label={tr('composer.switchModel')}
                className="flex w-full min-w-0 items-center gap-1.5 rounded-full px-2 py-1 text-[11.5px] text-ink-2 hover:bg-hover"
              >
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    snapshot.provider.connected === true ? 'bg-ok' : status === 'connecting' ? 'bg-warn' : 'bg-ink-3'
                  }`}
                />
                <span className="min-w-[4.5rem] truncate font-mono">{providerLine}</span>
                <Icon
                  name="chevron"
                  size={11}
                  className={`shrink-0 text-ink-3 ${pickerOpen ? '-rotate-90' : 'rotate-90'}`}
                />
              </button>

              {pickerOpen && provider ? (
                <div
                  data-composer-models
                  className="absolute bottom-full left-0 z-30 mb-1 w-[280px] rounded-lg border border-line bg-elevated shadow-lg"
                >
                  <div className="flex gap-1 border-b border-line px-1 py-1" data-model-filters role="group" aria-label={tr('composer.filter')}>
                    {(['all', 'vision', 'context'] as const).map((id) => (
                      <button
                        key={id}
                        type="button"
                        data-model-filter={id}
                        aria-pressed={modelFilter === id}
                        className={`rounded-md px-2 py-0.5 text-[10.5px] ${
                          modelFilter === id ? 'bg-hover font-medium text-ink' : 'text-ink-3 hover:text-ink'
                        }`}
                        onClick={() => setModelFilter(id)}
                      >
                        {tr(`composer.filter.${id}` as Parameters<typeof t>[1])}
                      </button>
                    ))}
                  </div>
                  <ul
                    role="listbox"
                    aria-label={tr('composer.switchModel')}
                    className="max-h-72 overflow-y-auto p-1"
                  >
                    {choices.length === 0 ? (
                      <li className="px-2 py-1.5 text-[11.5px] leading-5 text-ink-3">{tr('composer.modelEmpty')}</li>
                    ) : null}
                    {choices.length > 0 && visibleChoices.length === 0 ? (
                      <li className="px-2 py-1.5 text-[11.5px] leading-5 text-ink-3" data-model-filter-empty>
                        {tr('composer.filter.empty')}
                      </li>
                    ) : null}
                    {visibleChoices.map((model) => {
                      const selected = model === activeModel;
                      const detail = describeModelChoice({
                        id: model,
                        providerId: provider,
                        advertised: detailById.get(model),
                      });
                      const ctxLabel = detail
                        ? detail.contextWindow >= 1_000_000
                          ? `${Math.round(detail.contextWindow / 1_000_000)}M`
                          : detail.contextWindow >= 1000
                            ? `${Math.round(detail.contextWindow / 1000)}k`
                            : String(detail.contextWindow)
                        : null;
                      return (
                        <li key={model}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={selected}
                            data-model-option={model}
                            onClick={() => chooseModel(model)}
                            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11.5px] ${
                              selected ? 'bg-accent/12 font-medium text-accent' : 'text-ink-2 hover:bg-hover hover:text-ink'
                            }`}
                          >
                            <span className="flex min-w-0 flex-1 items-center gap-1.5">
                              <span data-model-name className="min-w-0 truncate font-mono">{model}</span>
                              {detail ? (
                                <span data-model-caps className="flex shrink-0 items-center gap-1 text-[10px] font-normal">
                                  {ctxLabel && detail.capabilitySource?.context !== 'default' && detail.capabilitySource?.context !== 'unknown' ? (
                                    <span className="rounded bg-hover px-1 text-ink-3" title={tr('composer.modelContext')}>{ctxLabel}</span>
                                  ) : null}
                                  {detail.supportsVision && detail.capabilitySource?.vision !== 'unknown' ? (
                                    <span className="rounded bg-info/15 px-1 text-info" title={tr('composer.modelVision')}>
                                      {tr('composer.filter.vision')}
                                    </span>
                                  ) : null}
                                </span>
                              ) : null}
                            </span>
                            {selected ? <Icon name="check" size={11} className="shrink-0" /> : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  <div className="flex items-center gap-1 border-t border-line p-1" data-model-manual>
                    <input
                      ref={manualRef}
                      data-model-manual-input
                      value={manualModel}
                      aria-label={tr('composer.modelManual')}
                      placeholder={tr('composer.modelManual')}
                      onChange={(event) => setManualModel(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter') return;
                        event.preventDefault();
                        event.stopPropagation();
                        chooseModel(manualModel);
                      }}
                      className="min-w-0 flex-1 rounded-md bg-transparent px-2 py-1 font-mono text-[11.5px] text-ink outline-none placeholder:text-ink-3"
                    />
                    <button
                      type="button"
                      data-model-manual-use
                      className="shrink-0 rounded-md px-2 py-1 text-[11.5px] text-ink-2 hover:bg-hover hover:text-ink"
                      onClick={() => chooseModel(manualModel)}
                    >
                      {tr('composer.modelUse')}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            <div ref={effortRef} className="relative shrink-0">
              <button
                type="button"
                data-composer-effort
                data-effort-option={effort}
                aria-haspopup="listbox"
                aria-expanded={effortOpen}
                title={tr('composer.effort')}
                aria-label={`${tr('composer.effort')}: ${tr(`composer.effort.${effort}` as Parameters<typeof t>[1])}`}
                onClick={() => setEffortOpen((open) => !open)}
                className="inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-[10.5px] font-medium text-ink-2 hover:bg-hover hover:text-ink"
              >
                {tr(`composer.effort.${effort}` as Parameters<typeof t>[1])}
                <Icon name="chevron" size={11} className={`text-ink-3 ${effortOpen ? '-rotate-90' : 'rotate-90'}`} />
              </button>
              {effortOpen ? (
                <ul
                  role="listbox"
                  data-effort-menu
                  aria-label={tr('composer.effort')}
                  className="absolute bottom-full right-0 z-30 mb-1 min-w-[120px] rounded-lg border border-line bg-elevated p-1 shadow-lg"
                >
                  {(['max', 'high', 'low'] as const).map((level) => {
                    const selected = level === effort;
                    return (
                      <li key={level}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={selected}
                          data-effort-choice={level}
                          onClick={() => {
                            setLocalPrefs({ effort: level });
                            setEffortOpen(false);
                          }}
                          className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11.5px] ${
                            selected ? 'bg-accent/12 font-medium text-accent' : 'text-ink-2 hover:bg-hover hover:text-ink'
                          }`}
                        >
                          <span className="min-w-0 flex-1">{tr(`composer.effort.${level}` as Parameters<typeof t>[1])}</span>
                          {selected ? <Icon name="check" size={11} /> : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>

            {running && mode !== 'work' ? (
              <button
                type="submit"
                data-run
                disabled={!value.trim()}
                className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-info px-3.5 text-[12.5px] font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:bg-line disabled:text-ink-2 disabled:opacity-100"
              >
                <Icon name="send" size={13} />
                {tr('steer')}
              </button>
            ) : (
              <button
                type="submit"
                data-run
                disabled={!value.trim() && !(conversational && pendingImages.length > 0)}
                aria-label={tr('composer.run')}
                title={tr('composer.run')}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent text-base text-white transition-colors hover:bg-accent-2 disabled:cursor-not-allowed disabled:bg-line disabled:text-ink-2"
              >
                <Icon name="arrowUp" size={15} />
              </button>
            )}
          </div>
        </div>

        {/*
          `ink-2`, not `ink-3`: this line is ours, not part of the Hermes sheet we adopted,
          and at `ink-3` it measured 2.73:1 on the paper background — below AA. The
          placeholder keeps `ink-3` because that value is Hermes' own.
        */}
        <p className="px-1.5 text-[10.5px] leading-4 text-ink-2">
          {tr('composer.enterToSend')} · {tr('composer.shiftEnter')}
        </p>
      </form>
    </footer>
  );
}

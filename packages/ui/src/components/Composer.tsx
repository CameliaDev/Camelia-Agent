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
 * The model chip switches the model in place. When the provider advertises a single
 * model the chip opens Settings rather than a one-item list. Switching model must not
 * silently switch vendor, so re-homing stays in Settings.
 *
 * Effort sits next to the model. Work mode also has the permission chip. Work, Math,
 * and Term live above the session list, not in this card.
 * @module
 */

import { useCallback, useEffect, useId, useRef, useState, type ClipboardEvent, type ReactNode } from 'react';

import type { ChatPolicy } from '@camelia/core';

import { makeCommand } from '../state/store.js';
import { useUiState, useUiStore } from '../state/UiProvider.js';
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

function policyLabelKey(policy: ChatPolicy): 'composer.policy.readonly' | 'composer.policy.ask' | 'composer.policy.full' {
  return policy === 'full'
    ? 'composer.policy.full'
    : policy === 'ask'
      ? 'composer.policy.ask'
      : 'composer.policy.readonly';
}

export function Composer({ centered = false }: { centered?: boolean } = {}): ReactNode {
  const { snapshot, activeSessionId, status, dispatch } = useUiState();
  const lang = useUiStore((s) => s.localPrefs.language);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const tr = (k: Parameters<typeof t>[1]) => t(lang, k);
  const [value, setValue] = useState('');
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
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
  const policyRef = useRef<HTMLDivElement>(null);

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
   * `models.length > 1` is the honest gate: with zero or one advertised model there is no
   * choice to offer, so the chip keeps its old job (open Settings) instead of rendering a
   * list of one. `modelsFor` must match the live provider — a run can re-route vendors
   * after bootstrap, and offering one vendor's models under another's name would be a
   * silent lie. The provider itself is never changed here; that is Settings' call.
   */
  const provider = snapshot.provider.activeProvider;
  const models = snapshot.provider.models ?? [];
  const modelDetails = snapshot.provider.modelDetails ?? [];
  const detailById = new Map(modelDetails.map((d) => [d.id, d]));
  const activeModel = snapshot.provider.activeModel;
  const canSwitch =
    models.length > 1 && provider !== undefined && snapshot.provider.modelsFor === provider;
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

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

  const submit = (): void => {
    const intent = value.trim();
    const images =
      conversational && pendingImages.length > 0
        ? pendingImages.map((img) => ({ mimeType: img.mimeType, dataBase64: img.dataBase64 }))
        : undefined;
    if (!intent && !(images && images.length)) return;
    if (conversational) {
      // 对话 mode: multimodal when images are pasted — OpenAI-compatible vision parts.
      dispatch(
        makeCommand('chat_message', {
          sessionId: activeSessionId ?? 'ses_new',
          text: intent,
          policy: chatPolicy,
          effort,
          ...(images?.length ? { images } : {}),
        }),
      );
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
    setValue('');
    setPendingImages([]);
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
          className="flex flex-col gap-1.5 rounded-2xl border border-line/60 bg-elevated p-2.5 shadow-sm transition-colors focus-within:border-line"
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
                aria-haspopup={canSwitch ? 'listbox' : undefined}
                aria-expanded={canSwitch ? pickerOpen : undefined}
                onClick={() => (canSwitch ? setPickerOpen((open) => !open) : setSettingsOpen(true))}
                title={canSwitch ? tr('composer.switchModel') : tr('composer.singleModel')}
                aria-label={canSwitch ? tr('composer.switchModel') : tr('composer.modelSettings')}
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
                  className={`shrink-0 text-ink-3 ${canSwitch && pickerOpen ? '-rotate-90' : 'rotate-90'}`}
                />
              </button>

              {pickerOpen && canSwitch ? (
                <ul
                  role="listbox"
                  data-composer-models
                  aria-label={tr('composer.switchModel')}
                  className="absolute bottom-full left-0 z-30 mb-1 max-h-72 min-w-[280px] overflow-y-auto rounded-lg border border-line bg-elevated p-1 shadow-lg"
                >
                  {models.map((model) => {
                    const selected = model === activeModel;
                    const detail = detailById.get(model);
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
                          onClick={() => {
                            if (provider !== undefined) {
                              dispatch(makeCommand('select_provider', { providerId: provider, model }));
                            }
                            setPickerOpen(false);
                          }}
                          className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11.5px] ${
                            selected ? 'bg-accent/12 font-medium text-accent' : 'text-ink-2 hover:bg-hover hover:text-ink'
                          }`}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-mono">{model}</span>
                            {detail ? (
                              <span className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] font-normal text-ink-3">
                                {ctxLabel ? <span title={tr('composer.modelContext')}>{ctxLabel} ctx</span> : null}
                                {detail.supportsVision ? (
                                  <span className="rounded bg-info/15 px-1 text-info" title={tr('composer.modelVision')}>
                                    vision
                                  </span>
                                ) : null}
                                {!detail.supportsTools ? (
                                  <span className="rounded bg-warn/15 px-1 text-warn">no-tools</span>
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
              ) : null}
            </div>

            <button
              type="button"
              data-composer-effort
              data-effort-option={effort}
              title={tr('composer.effort')}
              aria-label={`${tr('composer.effort')}: ${tr(`composer.effort.${effort}` as Parameters<typeof t>[1])}`}
              onClick={() => {
                const next = effort === 'max' ? 'high' : effort === 'high' ? 'low' : 'max';
                setLocalPrefs({ effort: next });
              }}
              className="shrink-0 rounded-full px-2 py-[3px] text-[10.5px] font-medium text-ink-2 hover:bg-hover hover:text-ink"
            >
              {tr(`composer.effort.${effort}` as Parameters<typeof t>[1])}
            </button>

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

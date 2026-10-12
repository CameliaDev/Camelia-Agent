/**
 * Math stage map tests.
 *
 * ## What these actually protect
 *
 * The engine's injected pipeline lives in `packages/harness/src/prompts/math-modeling.ts`
 * (`MATH_MODELING_STEP_TEMPLATE`, consumed by `prompts/system.ts`). The UI compresses it
 * into four stages. If someone adds or renumbers a template entry, this compression starts
 * lying about progress.
 *
 * So the key test here **reads the harness source off disk** and compares its step count
 * and order against the UI's axis. A test that only compared the UI to its own constant
 * would pass no matter what the harness did — which would make it worthless as a drift
 * guard.
 * @module
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ENGINE_MATH_STEPS,
  MATH_STAGES,
  overallForEngineStep,
  stageForEngineStep,
  stageIndex,
  stageSpec,
} from '../src/modes/math/mathStageMap.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const HARNESS_SOURCE = path.resolve(here, '../../harness/src/prompts/math-modeling.ts');

/** The template entries the harness injects, parsed from source. */
function harnessTemplateEntries(): string[] {
  const src = readFileSync(HARNESS_SOURCE, 'utf8');
  const start = src.indexOf('MATH_MODELING_STEP_TEMPLATE');
  expect(start).toBeGreaterThan(-1);
  const open = src.indexOf('[', start);
  const close = src.indexOf(']', open);
  expect(open).toBeGreaterThan(-1);
  expect(close).toBeGreaterThan(open);
  const body = src.slice(open + 1, close);
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith("'") || line.startsWith('"'))
    .map((line) => line.replace(/^['"]/, '').replace(/['"],?$/, ''));
}

describe('math stage map — against the harness source', () => {
  it('covers exactly as many steps as the harness template actually has', () => {
    const template = harnessTemplateEntries();
    // Sanity: we really parsed the template, not an empty slice.
    expect(template.length).toBeGreaterThan(3);
    expect(template[0]).toContain('重述');
    // This is the assertion that fails when someone edits the harness pipeline.
    expect(ENGINE_MATH_STEPS).toBe(template.length);
  });

  it('covers the injected pipeline with no gaps and no overlaps', () => {
    const template = harnessTemplateEntries();
    const covered = MATH_STAGES.flatMap((s) => [...s.engineSteps]).sort((a, b) => a - b);
    const expected = Array.from({ length: template.length }, (_, i) => i + 1);
    expect(covered).toEqual(expected);
  });
});

describe('math stage map — internal invariants', () => {
  it('keeps stage ends monotonically increasing and finishing at 1', () => {
    const ends = MATH_STAGES.map((s) => s.endsAt);
    for (let i = 1; i < ends.length; i += 1) {
      expect(ends[i]!).toBeGreaterThan(ends[i - 1]!);
    }
    expect(ends[ends.length - 1]).toBe(1);
  });

  it('weights stages by step count rather than equal quarters', () => {
    // Modeling covers 3 of 7 steps — not 0.25.
    expect(stageSpec('modeling').endsAt).toBeCloseTo(3 / 7, 10);
    expect(stageSpec('solving').endsAt).toBeCloseTo(4 / 7, 10);
    expect(stageSpec('verifying').endsAt).toBeCloseTo(6 / 7, 10);
    expect(stageSpec('modeling').endsAt).not.toBeCloseTo(0.25, 3);
  });

  it('routes every step to the stage that owns it', () => {
    expect(stageForEngineStep(1)).toBe('modeling');
    expect(stageForEngineStep(3)).toBe('modeling');
    expect(stageForEngineStep(4)).toBe('solving');
    expect(stageForEngineStep(5)).toBe('verifying');
    expect(stageForEngineStep(6)).toBe('verifying');
    expect(stageForEngineStep(7)).toBe('reporting');
  });

  it('clamps out-of-range steps instead of falling through to the first stage', () => {
    expect(stageForEngineStep(0)).toBe('modeling');
    // Without clamping this returns 'modeling', making a finished run look unstarted.
    expect(stageForEngineStep(99)).toBe('reporting');
    expect(stageForEngineStep(-5)).toBe('modeling');
  });

  it('advances overall progress within a step', () => {
    expect(overallForEngineStep(1, 0)).toBeCloseTo(0, 10);
    expect(overallForEngineStep(1, 1)).toBeCloseTo(1 / 7, 10);
    expect(overallForEngineStep(7, 1)).toBeCloseTo(1, 10);
    // Mid-step on step 4 (solving): between 3/7 and 4/7.
    expect(overallForEngineStep(4, 0.5)).toBeCloseTo(3.5 / 7, 10);
  });

  it('reports a stable 0-based stage index', () => {
    expect(stageIndex('modeling')).toBe(0);
    expect(stageIndex('reporting')).toBe(3);
  });
});

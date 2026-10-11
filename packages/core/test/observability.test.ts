import { describe, expect, it } from 'vitest';

import { CollectingLogger, RedactingLogger, streamSink } from '../src/observability/Logger.js';
import { InMemoryMetrics } from '../src/observability/Metrics.js';
import { InMemoryTracer } from '../src/observability/Tracer.js';
import { redact, redactText } from '../src/ports/logger.js';

describe('InMemoryTracer', () => {
  it('creates a parent/child span tree with a shared traceId', () => {
    const tracer = new InMemoryTracer();
    const root = tracer.startSpan('task');
    const child = tracer.startSpan('step', { parentId: root.id, traceId: root.traceId });
    const grandchild = tracer.startSpan('tool', { parentId: child.id, traceId: root.traceId });

    expect(child.traceId).toBe(root.traceId);
    expect(grandchild.traceId).toBe(root.traceId);
    expect(tracer.childrenOf(root.id).map((s) => s.name)).toEqual(['step']);
    expect(tracer.childrenOf(child.id).map((s) => s.name)).toEqual(['tool']);
  });

  it('closes spans with status and attributes', () => {
    const tracer = new InMemoryTracer();
    const span = tracer.startSpan('step');
    tracer.end(span, 'error', { reason: 'tool failed' });
    const stored = tracer.getSpan(span.id);
    expect(stored?.status).toBe('error');
    expect(stored?.endedAt).toBeGreaterThan(0);
    expect(stored?.attributes.reason).toBe('tool failed');
  });

  it('reports 1.0 completeness when every parent resolves', () => {
    const tracer = new InMemoryTracer();
    const root = tracer.startSpan('task');
    tracer.startSpan('step', { parentId: root.id, traceId: root.traceId });
    expect(tracer.traceCompleteness()).toBe(1);
  });

  it('detects orphan spans (dangling parentId)', () => {
    const tracer = new InMemoryTracer();
    tracer.startSpan('orphan', { parentId: 'does-not-exist', traceId: 't' });
    expect(tracer.traceCompleteness()).toBe(0);
  });

  it('returns 1.0 for an empty tracer and can reset', () => {
    const tracer = new InMemoryTracer();
    expect(tracer.traceCompleteness()).toBe(1);
    tracer.startSpan('a');
    tracer.reset();
    expect(tracer.spans()).toHaveLength(0);
  });
});

describe('InMemoryMetrics', () => {
  it('accumulates counters', () => {
    const metrics = new InMemoryMetrics();
    metrics.inc('tool.invocations');
    metrics.inc('tool.invocations', {}, 2);
    const sample = metrics.snapshot().find((s) => s.name === 'tool.invocations');
    expect(sample?.value).toBe(3);
    expect(sample?.count).toBe(2);
  });

  it('keeps separate series per tag set', () => {
    const metrics = new InMemoryMetrics();
    metrics.inc('tool.invocations', { tool: 'fs.read' });
    metrics.inc('tool.invocations', { tool: 'shell.exec' });
    metrics.inc('tool.invocations', { tool: 'shell.exec' });
    const samples = metrics.snapshot();
    expect(samples).toHaveLength(2);
    expect(samples.find((s) => s.tags.tool === 'shell.exec')?.value).toBe(2);
  });

  it('sets gauges to an absolute value', () => {
    const metrics = new InMemoryMetrics();
    metrics.gauge('ctx.tokens', 100);
    metrics.gauge('ctx.tokens', 42);
    expect(metrics.snapshot()[0]?.value).toBe(42);
  });

  it('computes percentiles from observations', () => {
    const metrics = new InMemoryMetrics();
    for (let i = 1; i <= 100; i += 1) metrics.observe('tool.latency_ms', i);
    expect(metrics.percentile('tool.latency_ms', 95)).toBe(95);
    expect(metrics.percentile('tool.latency_ms', 50)).toBe(50);
  });

  it('returns 0 for an unknown percentile', () => {
    const metrics = new InMemoryMetrics();
    expect(metrics.percentile('nope', 95)).toBe(0);
  });

  it('queries by name prefix', () => {
    const metrics = new InMemoryMetrics();
    metrics.inc('tool.invocations');
    metrics.inc('ctx.tokens');
    expect(metrics.query('tool.')).toHaveLength(1);
  });

  it('resets', () => {
    const metrics = new InMemoryMetrics();
    metrics.inc('x');
    metrics.reset();
    expect(metrics.snapshot()).toHaveLength(0);
  });
});

describe('redaction', () => {
  it('redacts secret-looking object keys', () => {
    const out = redact({ apiKey: 'sk-abc', nested: { Authorization: 'Bearer x', safe: 1 } });
    expect(out).toEqual({ apiKey: '[redacted]', nested: { Authorization: '[redacted]', safe: 1 } });
  });

  it('redacts arrays recursively', () => {
    const out = redact([{ token: 'x' }, 'plain']);
    expect(out).toEqual([{ token: '[redacted]' }, 'plain']);
  });

  it('redacts secret patterns in free text', () => {
    expect(redactText('key sk-abcdefghijklmnop')).toBe('key [redacted]');
    expect(redactText('Bearer abcdefghijklmn')).toBe('Bearer [redacted]');
  });

  it('guards against deep recursion', () => {
    let deep: Record<string, unknown> = { v: 1 };
    for (let i = 0; i < 20; i += 1) deep = { child: deep };
    expect(JSON.stringify(redact(deep as never))).toContain('[deep]');
  });
});

describe('loggers', () => {
  it('RedactingLogger honours the minimum level and redacts', () => {
    const records: string[] = [];
    const logger = new RedactingLogger(streamSink((line) => records.push(line)), 'info');
    logger.debug('hidden');
    logger.info('visible', { apiKey: 'sk-secretvalue123' });
    expect(records).toHaveLength(1);
    expect(records[0]).toContain('[redacted]');
    expect(records[0]).not.toContain('sk-secretvalue123');
  });

  it('child() merges bindings', () => {
    const logger = new CollectingLogger('debug');
    const child = logger.child({ taskId: 't1' });
    child.info('hi');
    expect(logger.records).toHaveLength(1);
  });

  it('CollectingLogger exposes records for assertions', () => {
    const logger = new CollectingLogger('warn');
    logger.info('nope');
    logger.warn('yes');
    logger.error('also');
    expect(logger.records.map((r) => r.level)).toEqual(['warn', 'error']);
  });
});
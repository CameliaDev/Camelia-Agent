/**
 * Metrics — aggregated counters and observations.
 *
 * Kept in-memory and flushed to SQLite by the session store. This is the data
 * source for the acceptance report in chapter 9 of the whitepaper.
 * @module
 */

export type Tags = Record<string, string>;

export interface MetricSample {
  name: string;
  /** Sum for counters, last value for gauges, aggregated for observations. */
  value: number;
  count: number;
  tags: Tags;
  updatedAt: number;
}

export interface MetricsPort {
  /** Add to a counter. */
  inc(name: string, tags?: Tags, delta?: number): void;
  /** Set a gauge to an absolute value. */
  gauge(name: string, value: number, tags?: Tags): void;
  /** Record a distribution sample (latency, tokens, ...). */
  observe(name: string, value: number, tags?: Tags): void;
  snapshot(): MetricSample[];
  /** All samples matching a metric name prefix. */
  query(prefix: string): MetricSample[];
  reset(): void;
}

function tagKey(tags: Tags = {}): string {
  const keys = Object.keys(tags).sort();
  return keys.map((k) => `${k}=${tags[k]}`).join(',');
}

export class InMemoryMetrics implements MetricsPort {
  private readonly samples = new Map<string, MetricSample>();
  private readonly observations = new Map<string, number[]>();

  private key(name: string, tags?: Tags): string {
    return `${name}|${tagKey(tags)}`;
  }

  inc(name: string, tags: Tags = {}, delta = 1): void {
    const k = this.key(name, tags);
    const existing = this.samples.get(k);
    if (existing) {
      existing.value += delta;
      existing.count += 1;
      existing.updatedAt = Date.now();
    } else {
      this.samples.set(k, { name, value: delta, count: 1, tags, updatedAt: Date.now() });
    }
  }

  gauge(name: string, value: number, tags: Tags = {}): void {
    const k = this.key(name, tags);
    const existing = this.samples.get(k);
    if (existing) {
      existing.value = value;
      existing.count += 1;
      existing.updatedAt = Date.now();
    } else {
      this.samples.set(k, { name, value, count: 1, tags, updatedAt: Date.now() });
    }
  }

  observe(name: string, value: number, tags: Tags = {}): void {
    const k = this.key(name, tags);
    const list = this.observations.get(k) ?? [];
    list.push(value);
    this.observations.set(k, list);

    const existing = this.samples.get(k);
    if (existing) {
      existing.value = value;
      existing.count = list.length;
      existing.updatedAt = Date.now();
    } else {
      this.samples.set(k, { name, value, count: 1, tags, updatedAt: Date.now() });
    }
  }

  snapshot(): MetricSample[] {
    return [...this.samples.values()].map((s) => ({ ...s, tags: { ...s.tags } }));
  }

  query(prefix: string): MetricSample[] {
    return this.snapshot().filter((s) => s.name.startsWith(prefix));
  }

  /** Distribution samples for a metric (used to compute p95 latency). */
  distribution(name: string, tags: Tags = {}): number[] {
    return [...(this.observations.get(this.key(name, tags)) ?? [])];
  }

  /**
   * Percentile helper (nearest-rank method) — p95 tool latency is a
   * first-class observability metric. `p=95` over 1..100 yields 95.
   */
  percentile(name: string, p: number, tags: Tags = {}): number {
    const values = this.distribution(name, tags).sort((a, b) => a - b);
    if (values.length === 0) return 0;
    const rank = Math.ceil((p / 100) * values.length);
    const idx = Math.min(values.length - 1, Math.max(0, rank - 1));
    return values[idx]!;
  }

  reset(): void {
    this.samples.clear();
    this.observations.clear();
  }
}
/**
 * Which memories belong on the settings page.
 *
 * Task runs write a short `artifact` row ("produced N artifact(s)…"). That is a
 * run log. Settings shows durable facts: preferences, lessons, procedures, and
 * plain facts. The task panel can still list the run log.
 * @module
 */

const CURATED_KINDS = new Set(['fact', 'preference', 'lesson', 'procedural']);

/** True when this row is a curated fact, not a task-run summary. */
export function isCuratedMemory(item: { kind: string; content: string }): boolean {
  if (item.kind === 'artifact') return false;
  if (/produced \d+ artifact/.test(item.content)) return false;
  return CURATED_KINDS.has(item.kind);
}

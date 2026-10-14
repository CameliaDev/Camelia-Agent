/**
 * Shipped heuristic table. The JSON file is the editable copy; this string is
 * what the process loads so a build does not have to copy the file into dist.
 * A test asserts the two parses match.
 * @module
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { HeuristicTable } from './heuristic.js';
import { parseHeuristicTable } from './heuristic.js';

export const DEFAULT_HEURISTIC_JSON = `{
  "heuristic_table_version": "1.0.0",
  "rules": [
    {
      "id": "test-ok",
      "errorClass": "test",
      "environment": "OK",
      "priority": 30,
      "enabled": true,
      "candidates": ["rerun_verifier", "consult_docs", "rollback"]
    },
    {
      "id": "type-ok",
      "errorClass": "type",
      "environment": "OK",
      "priority": 30,
      "enabled": true,
      "candidates": ["rerun_verifier", "consult_docs"]
    },
    {
      "id": "sandbox-ok",
      "errorClass": "sandbox",
      "environment": "OK",
      "priority": 20,
      "enabled": true,
      "candidates": ["escalate_human", "rollback"]
    },
    {
      "id": "lint-ok",
      "errorClass": "lint",
      "environment": "OK",
      "priority": 10,
      "enabled": true,
      "candidates": ["consult_docs", "rerun_verifier"]
    },
    {
      "id": "env-fail",
      "errorClass": "env",
      "environment": "FAIL",
      "priority": 40,
      "enabled": true,
      "candidates": ["repair_environment", "escalate_human"]
    },
    {
      "id": "tool-ok",
      "errorClass": "tool",
      "environment": "OK",
      "priority": 20,
      "enabled": true,
      "candidates": ["rollback", "consult_docs"]
    },
    {
      "id": "model-ok",
      "errorClass": "model",
      "environment": "OK",
      "priority": 20,
      "enabled": true,
      "candidates": ["rerun_verifier", "escalate_human"]
    },
    {
      "id": "policy-ok",
      "errorClass": "policy",
      "environment": "OK",
      "priority": 20,
      "enabled": true,
      "candidates": ["escalate_human", "consult_docs"]
    },
    {
      "id": "contract-ok",
      "errorClass": "contract",
      "environment": "OK",
      "priority": 20,
      "enabled": true,
      "candidates": ["narrow_diff", "consult_docs", "rollback"]
    }
  ]
}
`;

export function defaultHeuristicTable(): HeuristicTable {
  const parsed = parseHeuristicTable(DEFAULT_HEURISTIC_JSON);
  if (!parsed.ok) throw new Error(`shipped heuristic table is invalid: ${parsed.reason}`);
  return parsed.table;
}

/** Read the sibling JSON. Tests use this to prove the file and the string agree. */
export function readShippedHeuristicFile(): string {
  return readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'heuristics.v1.json'), 'utf8');
}

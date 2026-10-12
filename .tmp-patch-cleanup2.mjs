import fs from 'node:fs';

function edit(path, fn) {
  const raw = fs.readFileSync(path, 'utf8');
  const crlf = raw.includes('\r\n');
  let s = raw.replace(/\r\n/g, '\n');
  s = fn(s);
  fs.writeFileSync(path, crlf ? s.replace(/\n/g, '\r\n') : s);
}

edit('packages/ui/src/components/RightRail.tsx', (s) => {
  s = s.replace(
    `  const tr = useTr();\n  const rollbackOk = true; // display-only timeline; restore goes through FailureCard / Conversation\n  return (\n    <section className="border-b border-line" data-checkpoint-section>`,
    `  const tr = useTr();\n  return (\n    <section className="border-b border-line" data-checkpoint-section>`,
  );
  s = s.replace(`        {!rollbackOk ? null : null}\n      </div>`, `      </div>`);
  return s;
});

edit('packages/ui/test/provider-presets.test.ts', (s) => {
  if (!s.includes('PRESET_TEMPLATES,')) {
    s = s.replace(
      `import {
  buildPresetCards,
  slugifyProviderId,
  uniqueProviderId,
} from '../src/window/provider-presets.js';`,
      `import {
  PRESET_TEMPLATES,
  buildPresetCards,
  slugifyProviderId,
  uniqueProviderId,
} from '../src/window/provider-presets.js';`,
    );
  }
  s = s.replace(/const \{ PRESET_TEMPLATES \} = require\([^;]+;\n\s*/g, '');
  if (!s.includes('exposes the five wireframe templates')) {
    s = s.replace(
      `    expect(ollama.persisted).toBe(false);\n  });\n});`,
      `    expect(ollama.persisted).toBe(false);
  });

  it('exposes the five wireframe templates including 阿里云兼容 / 自定义', () => {
    const ids = PRESET_TEMPLATES.map((t) => t.id);
    expect(ids).toEqual(['aliyun', 'openrouter', 'opencode-zen', 'ollama', 'custom']);
    expect(PRESET_TEMPLATES[0]?.label).toContain('阿里云');
    expect(PRESET_TEMPLATES[4]?.label).toBe('自定义');
  });
});`,
    );
  }
  return s;
});

// Add a small capabilities unit test file
fs.writeFileSync(
  'packages/ui/test/capabilities.test.ts',
  `/**
 * Live-engine intervene honesty.
 * @module
 */
import { describe, expect, it } from 'vitest';

import { canIntervene, interveneUnavailableReason } from '../src/window/capabilities.js';

describe('capabilities (fixture / no boot)', () => {
  it('allows rollback and degrade when not attached to a live engine', () => {
    expect(canIntervene('rollback_step')).toBe(true);
    expect(canIntervene('select_provider')).toBe(true);
    expect(interveneUnavailableReason('rollback_step')).toBe('');
  });
});
`,
);
console.log('cleanup2 ok');

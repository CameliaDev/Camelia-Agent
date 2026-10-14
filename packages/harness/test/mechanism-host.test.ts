import { describe, expect, it } from 'vitest';

import { MechanismHost, type Mechanism } from '../src/mechanisms/MechanismHost.js';
import type { Tool } from '../src/tools/types.js';

function tool(name: string): Tool {
  return {
    name,
    description: name,
    schema: { type: 'object', properties: {} },
    risk: 'read-only',
    reversible: true,
    async run() {
      return null;
    },
  };
}

describe('MechanismHost', () => {
  it('collects tools from registered mechanisms without merging ids', () => {
    const host = new MechanismHost();
    const math: Mechanism = {
      id: 'math',
      description: 'math tools',
      tools: () => [tool('math.exec')],
    };
    host.register(math);
    expect(host.tools().map((item) => item.name)).toEqual(['math.exec']);
    expect(host.sourceOf('math.exec')).toBe('math');
    expect(() => host.register(math)).toThrow(/already registered/);
  });
});

/**
 * Extension point for a new mechanism's tools.
 *
 * AgentLoop stays the task loop. A mechanism contributes tools (and, later, a
 * claim on an intent) without another branch inside that loop. Team orchestration
 * remains `TeamOrchestrator`; new tool families register here and the runtime
 * mounts them onto `ToolEngine` with a source id.
 * @module
 */

import type { Tool } from '../tools/types.js';

export interface Mechanism {
  /** Stable id. The runtime records it as the tool source. */
  id: string;
  /** One line for diagnostics and docs. */
  description: string;
  tools(): readonly Tool[];
}

export class MechanismHost {
  private readonly mechanisms: Mechanism[] = [];

  register(mechanism: Mechanism): void {
    if (this.mechanisms.some((item) => item.id === mechanism.id)) {
      throw new Error(`Mechanism already registered: ${mechanism.id}`);
    }
    this.mechanisms.push(mechanism);
  }

  list(): readonly Mechanism[] {
    return this.mechanisms;
  }

  tools(): Tool[] {
    const out: Tool[] = [];
    for (const mechanism of this.mechanisms) {
      for (const tool of mechanism.tools()) out.push(tool);
    }
    return out;
  }

  sourceOf(toolName: string): string | undefined {
    for (const mechanism of this.mechanisms) {
      if (mechanism.tools().some((tool) => tool.name === toolName)) return mechanism.id;
    }
    return undefined;
  }
}

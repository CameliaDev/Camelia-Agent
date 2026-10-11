/**
 * Built-in tool registry.
 * @module
 */

import type { Tool } from '../types.js';
import { fsTools } from './fs-tools.js';
import { searchTools } from './search-tools.js';
import { shellTools } from './shell-tools.js';

export * from './fs-tools.js';
export * from './search-tools.js';
export * from './shell-tools.js';

/** Every tool Camelia ships with. */
export const builtinTools: Tool<any, any>[] = [...fsTools, ...searchTools, ...shellTools];
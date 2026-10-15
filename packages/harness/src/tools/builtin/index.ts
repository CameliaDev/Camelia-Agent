/**
 * Built-in tool registry.
 * @module
 */

import type { Tool } from '../types.js';
import { fsTools } from './fs-tools.js';
import { mathExecTool } from './math-tools.js';
import { searchTools } from './search-tools.js';
import { shellTools } from './shell-tools.js';
import { webSearchTools } from './web-search-tools.js';
import { desktopTools } from './desktop-tools.js';

export * from './fs-tools.js';
export * from './math-tools.js';
export * from './search-tools.js';
export * from './shell-tools.js';
export * from './web-search-tools.js';
export * from './desktop-tools.js';

/** Every tool Camelia ships with. */
export const builtinTools: Tool<any, any>[] = [...fsTools, mathExecTool, ...searchTools, ...webSearchTools, ...shellTools, ...desktopTools];

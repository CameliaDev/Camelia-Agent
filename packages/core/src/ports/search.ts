/**
 * Search port — deterministic file location.
 *
 * Whitepaper §5.5: models hallucinate paths. Camelia resolves them with glob/grep
 * so the model only ever *chooses* among real candidates.
 * @module
 */

export interface GrepMatch {
  /** Workspace-relative posix path. */
  path: string;
  /** 1-based line number. */
  line: number;
  /** 1-based column. */
  column: number;
  text: string;
}

export interface GlobOptions {
  cwd?: string;
  ignore?: string[];
  maxResults?: number;
}

export interface GrepOptions {
  cwd?: string;
  /** Glob restricting which files are searched. */
  glob?: string;
  /** Directory names or path fragments to skip. */
  ignore?: string[];
  ignoreCase?: boolean;
  /** Treat `pattern` as a regular expression (default true). */
  regex?: boolean;
  maxResults?: number;
  /** Maximum matches per file. */
  maxPerFile?: number;
}

export interface SearchPort {
  glob(pattern: string, options?: GlobOptions): Promise<string[]>;
  grep(pattern: string, options?: GrepOptions): Promise<GrepMatch[]>;
}
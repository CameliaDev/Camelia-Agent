/**
 * Filesystem port. All workspace IO goes through this boundary so that
 * containment, checkpointing and rollback can be enforced in one place.
 * @module
 */

export interface DirEntry {
  name: string;
  /** Workspace-relative posix path. */
  path: string;
  type: 'file' | 'dir' | 'symlink';
  size?: number;
}

export interface FileStat {
  path: string;
  size: number;
  mtimeMs: number;
  isFile: boolean;
  isDir: boolean;
}

export interface ListOptions {
  recursive?: boolean;
  maxEntries?: number;
  ignore?: string[];
}

export interface FsPort {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  list(dir: string, options?: ListOptions): Promise<DirEntry[]>;
  stat(path: string): Promise<FileStat>;
  mkdir(path: string): Promise<void>;
  remove(path: string): Promise<void>;
  /** Content hash used for change detection, checkpoints and rollback verification. */
  hash(path: string): Promise<string>;
}
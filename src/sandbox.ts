/**
 * Every file the server touches must live under one root directory.
 *
 * Resolving the *real* path (after symlinks) before the prefix check closes the
 * classic escapes: `../../etc/passwd`, absolute paths and symlinks pointing out.
 */
import { realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

export class SandboxError extends Error {}

export const MAX_FILE_BYTES = 20 * 1024 * 1024;

export class Sandbox {
  readonly root: string;

  constructor(root: string) {
    this.root = realpathSync(resolve(root));
  }

  /** Resolve a user-supplied path to an existing file inside the root. */
  file(userPath: string, allowedExtensions?: string[]): string {
    if (userPath.includes("\0")) throw new SandboxError("Invalid path.");
    const candidate = resolve(this.root, userPath);
    let real: string;
    try {
      real = realpathSync(candidate);
    } catch {
      throw new SandboxError(`File not found: ${userPath}`);
    }
    const rel = relative(this.root, real);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new SandboxError(`Access denied: ${userPath} is outside the allowed directory.`);
    }
    const stats = statSync(real);
    if (!stats.isFile()) throw new SandboxError(`Not a file: ${userPath}`);
    if (stats.size > MAX_FILE_BYTES) {
      throw new SandboxError(`File too large (${stats.size} bytes, max ${MAX_FILE_BYTES}).`);
    }
    if (allowedExtensions && !allowedExtensions.some((ext) => real.toLowerCase().endsWith(ext))) {
      throw new SandboxError(`Expected one of ${allowedExtensions.join(", ")}: ${userPath}`);
    }
    return real;
  }

  /** Path relative to the root, for messages and resource URIs. */
  display(absolutePath: string): string {
    return relative(this.root, absolutePath);
  }
}

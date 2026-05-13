-- Bun's bundled SQLite in this repo does not expose sha1/sha3 hashing functions,
-- while runtime ProjectID.nonGit() derives ids from a normalized directory path via
-- Hash.fast() (SHA-1). Keep this migration executable and let the runtime fallback in
-- Project.fromDirectory() migrate legacy global non-git sessions when each directory is
-- first resolved.
SELECT 1;

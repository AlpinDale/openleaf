import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Installs only approved hooks in a fresh private directory. */
export async function installGitHooks(
  hooksDir: string,
  maxUploadBytes: number,
  maxProjectStateBytes: number
) {
  const source = import.meta.url.endsWith('.ts')
  const validator = fileURLToPath(
    new URL(
      source ? './receive-limits.ts' : './receive-limits.js',
      import.meta.url
    )
  )
  const loader = source
    ? ` --conditions=development --import '${fileURLToPath(import.meta.resolve('tsx')).replaceAll("'", "'\\''")}'`
    : ''
  const node = `'${process.execPath.replaceAll("'", "'\\''")}'`
  const script = `'${validator.replaceAll("'", "'\\''")}'`
  const preReceive = `#!/bin/sh
if [ -f "$GIT_DIR/openleaf-dirty" ]; then
  echo "OpenLeaf: this project has changes newer than your last pull. Run 'git pull' and push again." >&2
  exit 1
fi
while read -r old new ref; do
  if [ "$ref" != "refs/heads/main" ]; then echo "OpenLeaf: only the main branch can be pushed." >&2; exit 1; fi
  if [ "$new" = "0000000000000000000000000000000000000000" ]; then echo "OpenLeaf: deleting main is not allowed." >&2; exit 1; fi
  if [ -n "\${OPENLEAF_GIT_PROCESS_MEMORY_BYTES:-}" ]; then
    # Node needs a large virtual address reservation; Git children restore the cap.
    ulimit -S -v "$(ulimit -H -v)" || exit 1
  fi
  ${node}${loader} ${script} ${maxUploadBytes} "$new" ${maxProjectStateBytes} || exit 1
done
exit 0
`
  await fsp.mkdir(hooksDir, { recursive: true, mode: 0o700 })
  if (!(await fsp.lstat(hooksDir)).isDirectory()) {
    throw new Error('Git hooks root must be a directory, not a symlink')
  }
  const managed = await fsp.mkdtemp(path.join(hooksDir, 'managed-'))
  const file = path.join(managed, 'pre-receive')
  try {
    await fsp.writeFile(file, preReceive, {
      mode: 0o755,
      flag: 'wx',
    })
    await fsp.chmod(file, 0o755)
    return managed
  } catch (error) {
    await fsp.rm(managed, { recursive: true, force: true })
    throw error
  }
}

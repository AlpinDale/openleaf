import process from 'node:process'

/** Production containers use a soft address-space cap for native Git children. */
export function nativeGitCommand(args: string[], memoryBytes: number) {
  if (process.platform !== 'linux' || !memoryBytes) return { file: 'git', args }
  return {
    file: 'prlimit',
    // The trusted pre-receive Node validator raises only its own soft limit;
    // every native Git command it launches restores this cap.
    args: [`--as=${memoryBytes}:`, '--', 'git', ...args],
  }
}

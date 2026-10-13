// Algorithm from Overleaf services/web/frontend/js/features/ide-react/util/disambiguate-paths.ts (AGPL-3.0)

/**
 * Shortest display path per tab: the file name, plus as many parent folders
 * as needed to tell apart tabs with the same name. `paths` are project
 * relative (`a/b/main.tex`); the result is in the same order.
 */
export function disambiguatePaths(paths: readonly string[]): string[] {
  const segments = paths.map(path => path.split('/'))
  const depths = paths.map(() => 0)
  const results: (string | undefined)[] = paths.map(() => undefined)
  const display = (i: number) =>
    segments[i].slice(segments[i].length - 1 - depths[i]).join('/')

  for (;;) {
    const collisions = new Map<string, number[]>()
    paths.forEach((_path, i) => {
      if (results[i] !== undefined) return
      const key = display(i)
      collisions.set(key, [...(collisions.get(key) ?? []), i])
    })
    let revealed = false
    for (const [key, indices] of collisions) {
      if (indices.length === 1) {
        results[indices[0]] = key
        continue
      }
      for (const i of indices) {
        if (depths[i] < segments[i].length - 1) {
          depths[i]++
          revealed = true
        } else {
          // the whole path collides (same entry twice): fall back to the name
          results[i] = segments[i][segments[i].length - 1]
        }
      }
    }
    if (!revealed) break
  }
  return results.map((result, i) => result ?? display(i))
}

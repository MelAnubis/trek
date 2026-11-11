// Two modules whose paths differ only in letter case (AlbumBrowser.tsx / albumBrowser.ts)
// build on Linux but break on Windows and macOS, where `import './AlbumBrowser'` may land
// on the other file. Keep every module path unique ignoring case and extension.
import { readdirSync, statSync } from 'fs'
import { join, relative } from 'path'

function modules(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) modules(p, out)
    else if (/\.(ts|tsx|js|jsx)$/.test(name)) out.push(p)
  }
  return out
}

describe('module paths', () => {
  it('REPO-001: no two modules differ only in letter case', () => {
    const root = join(__dirname, '../../../src')
    const seen = new Map<string, string>()
    const clashes: string[] = []
    for (const file of modules(root)) {
      const key = relative(root, file).replace(/\.(test\.)?(ts|tsx|js|jsx)$/, '').toLowerCase()
      const prev = seen.get(key)
      if (prev && prev.toLowerCase() !== file.toLowerCase().replace(/\.(test\.)?(ts|tsx|js|jsx)$/, '') && prev !== file) {
        const a = relative(root, prev), b = relative(root, file)
        if (a.replace(/\.(test\.)?\w+$/, '') !== b.replace(/\.(test\.)?\w+$/, '')) clashes.push(`${a} ↔ ${b}`)
      }
      if (!prev) seen.set(key, file)
    }
    expect(clashes).toEqual([])
  })
})

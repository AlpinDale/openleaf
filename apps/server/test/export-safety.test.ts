import { describe, expect, it } from 'vitest'
import { flattenLatex } from '../src/export/flatten.js'
import { PandocOutputLimitError, runPandoc } from '../src/export/pandoc.js'

describe('bounded source flattening', () => {
  it('preserves ordinary repeated includes', () => {
    const docs = new Map([
      ['main.tex', '\\input{chapter}\n\\input{chapter}'],
      ['chapter.tex', 'Chapter text'],
    ])
    expect(flattenLatex('main.tex', docs)).toBe('Chapter text\nChapter text')
  })

  it('rejects exponential acyclic include chains before allocating their expansion', () => {
    const docs = new Map<string, string>()
    for (let depth = 0; depth < 15; depth++)
      docs.set(`${depth}.tex`, `\\input{${depth + 1}}`.repeat(8))
    docs.set('15.tex', 'terminal text')
    expect(() => flattenLatex('0.tex', docs)).toThrow(
      'Export source expansion limit reached'
    )
  })

  it('rejects an oversized standalone source', () => {
    expect(() =>
      flattenLatex(
        'main.tex',
        new Map([['main.tex', 'x'.repeat(16 * 1024 * 1024 + 1)]])
      )
    ).toThrow('Export source expansion limit reached')
  })
})

describe('pandoc subprocess bounds', () => {
  it('rejects output beyond the cap instead of buffering it without bound', async () => {
    await expect(
      runPandoc(
        process.execPath,
        [
          '-e',
          'const chunk=Buffer.alloc(1024*1024,120);for(let i=0;i<65;i++)process.stdout.write(chunk)',
        ],
        {
          cwd: process.cwd(),
          input: '',
          timeoutMs: 10_000,
        }
      )
    ).rejects.toBeInstanceOf(PandocOutputLimitError)
  }, 15_000)

  it('kills descendants retaining pipes after the leader exits', async () => {
    // Platform integration: real inherited pipes must close on the converter deadline.
    const result = await runPandoc(
      process.execPath,
      [
        '-e',
        "const {spawn}=require('node:child_process');spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});process.exit(0)",
      ],
      {
        cwd: process.cwd(),
        input: '',
        timeoutMs: 300,
      }
    )
    expect(result.timedOut).toBe(true)
  }, 5000)
})

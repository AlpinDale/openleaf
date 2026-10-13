export type ProjectCompiler = 'pdflatex' | 'latex' | 'xelatex' | 'lualatex'

export type SpellCheckLanguage = {
  name: string
  code: string
  dic?: string
  server?: false
}

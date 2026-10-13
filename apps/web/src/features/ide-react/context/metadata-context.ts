export type Command = {
  caption: string
  snippet: string
  meta: string
  score: number
}

export type DocumentMetadata = {
  labels: string[]
  packages: Record<string, Command[]>
  packageNames: string[]
}

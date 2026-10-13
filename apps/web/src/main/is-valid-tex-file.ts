const validTeXFileRegExp = /\.(tex|rtex|ltx|rnw)$/i

export const isValidTeXFile = (filename: string) =>
  validTeXFileRegExp.test(filename)

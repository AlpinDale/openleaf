import { fileExtension } from '@openleaf/shared'

const TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  eps: 'application/postscript',
  ps: 'application/postscript',
  zip: 'application/zip',
  gz: 'application/gzip',
  json: 'application/json',
  xml: 'application/xml',
  html: 'text/plain; charset=utf-8',
  htm: 'text/plain; charset=utf-8',
  log: 'text/plain; charset=utf-8',
  blg: 'text/plain; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  tex: 'text/plain; charset=utf-8',
  bib: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  md: 'text/plain; charset=utf-8',
  aux: 'text/plain; charset=utf-8',
  bbl: 'text/plain; charset=utf-8',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2',
}

export function contentTypeFor(name: string): string {
  return TYPES[fileExtension(name)] ?? 'application/octet-stream'
}

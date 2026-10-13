export type SpellLanguage = { code: string; name: string; pkg: string }

export const SPELL_LANGUAGES: readonly SpellLanguage[] = [
  { code: 'en_US', name: 'English (American)', pkg: 'dictionary-en' },
  { code: 'en_GB', name: 'English (British)', pkg: 'dictionary-en-gb' },
  { code: 'en_AU', name: 'English (Australian)', pkg: 'dictionary-en-au' },
  { code: 'en_CA', name: 'English (Canadian)', pkg: 'dictionary-en-ca' },
  { code: 'de', name: 'German', pkg: 'dictionary-de' },
  { code: 'de_AT', name: 'German (Austria)', pkg: 'dictionary-de-at' },
  { code: 'de_CH', name: 'German (Switzerland)', pkg: 'dictionary-de-ch' },
  { code: 'fr', name: 'French', pkg: 'dictionary-fr' },
  { code: 'es', name: 'Spanish', pkg: 'dictionary-es' },
  { code: 'it', name: 'Italian', pkg: 'dictionary-it' },
  { code: 'pt_BR', name: 'Portuguese (Brazilian)', pkg: 'dictionary-pt' },
  { code: 'pt_PT', name: 'Portuguese (European)', pkg: 'dictionary-pt-pt' },
  { code: 'nl', name: 'Dutch', pkg: 'dictionary-nl' },
  { code: 'pl', name: 'Polish', pkg: 'dictionary-pl' },
  { code: 'ru', name: 'Russian', pkg: 'dictionary-ru' },
  { code: 'sv', name: 'Swedish', pkg: 'dictionary-sv' },
  { code: 'da', name: 'Danish', pkg: 'dictionary-da' },
  { code: 'nb', name: 'Norwegian (Bokmål)', pkg: 'dictionary-nb' },
  { code: 'cs', name: 'Czech', pkg: 'dictionary-cs' },
  { code: 'tr', name: 'Turkish', pkg: 'dictionary-tr' },
  { code: 'uk', name: 'Ukrainian', pkg: 'dictionary-uk' },
]

export function findSpellLanguage(code: string): SpellLanguage | undefined {
  return SPELL_LANGUAGES.find(l => l.code === code)
}

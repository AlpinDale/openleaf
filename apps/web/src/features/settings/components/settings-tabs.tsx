// Option lists and labels adapted from Overleaf services/web/frontend/js/features/ide-settings/components/** (AGPL-3.0).
import {
  type Compiler,
  type ProjectDetails,
  type ProjectTree,
  SPELL_LANGUAGES,
  type UserSettings,
  type UserSettingsPatch,
} from '@openleaf/shared'
import { useMemo } from 'react'
import { patchMe } from '@/api/auth'
import { errorMessage } from '@/api/client'
import { type ProjectPatch, patchProject } from '@/api/projects'
import { indexTree } from '@/features/file-tree/util/tree-index'
import { useCompileStore } from '@/features/pdf-preview/compile-store'
import { showToast } from '@/features/toasts'
import { useTranslation } from '@/i18n'
import OLButton from '@/shared/components/ol/ol-button'
import { getMeta } from '@/utils/meta'
import { openDictionaryModal } from '../settings-modal-store'
import {
  DropdownSetting,
  type Optgroup,
  type Option,
  Setting,
  SettingsSection,
  ToggleSetting,
} from './setting'

const COMPILER_OPTIONS: Option<Compiler>[] = [
  { value: 'pdflatex', label: 'pdfLaTeX' },
  { value: 'latex', label: 'LaTeX' },
  { value: 'xelatex', label: 'XeLaTeX' },
  { value: 'lualatex', label: 'LuaLaTeX' },
]

const FONT_SIZE_OPTIONS: Option<number>[] = [
  10, 11, 12, 13, 14, 16, 18, 20, 22, 24,
].map(size => ({ value: size, label: `${size}px` }))

const FONT_FAMILY_OPTIONS: Option<UserSettings['fontFamily']>[] = [
  { value: 'monaco', label: 'Monaco / Menlo / Consolas' },
  { value: 'lucida', label: 'Lucida / Source Code Pro' },
  { value: 'opendyslexicmono', label: 'OpenDyslexic Mono' },
]

const KEYBINDING_OPTIONS: Option<UserSettings['keybindings']>[] = [
  { value: 'default', label: 'None' },
  { value: 'vim', label: 'Vim' },
  { value: 'emacs', label: 'Emacs' },
]

type EditorThemeMeta = { name: string; dark?: boolean }

/** Theme names bundled with the source editor, for when the editor hasn't published `ol-editorThemes`. */
const BUNDLED_THEMES: EditorThemeMeta[] = Object.keys(
  import.meta.glob('/src/features/source-editor/themes/cm6/*.json')
).map(file => ({ name: file.replace(/^.*\/|\.json$/g, '') }))

function useEditorThemeOptgroups(): Optgroup[] {
  const { t } = useTranslation()
  return useMemo(() => {
    const themes =
      (getMeta('ol-editorThemes') as EditorThemeMeta[] | undefined) ??
      BUNDLED_THEMES
    const toOption = ({ name }: EditorThemeMeta) => ({
      value: name,
      label: name.replace(/_/g, ' '),
    })
    const light = themes.filter(theme => !theme.dark).map(toOption)
    const dark = themes.filter(theme => theme.dark).map(toOption)
    return [
      { label: t('light_themes'), options: light },
      { label: t('dark_themes'), options: dark },
    ].filter(group => group.options.length > 0)
  }, [t])
}

function updateSettings(patch: UserSettingsPatch) {
  patchMe({ settings: patch }).catch(err =>
    showToast({ type: 'error', content: errorMessage(err) })
  )
}

function updateProject(projectId: string, patch: ProjectPatch) {
  patchProject(projectId, patch).catch(err =>
    showToast({ type: 'error', content: errorMessage(err) })
  )
}

/** Doc options `{id, path}` for docs whose name ends in `extension`, sorted by path. */
function useDocOptions(tree: ProjectTree, extension: string, keepId?: string) {
  return useMemo(() => {
    const index = indexTree(tree)
    return tree.entries
      .filter(
        entry =>
          entry.kind === 'doc' &&
          (entry.name.toLowerCase().endsWith(extension) || entry.id === keepId)
      )
      .map(entry => ({
        value: entry.id,
        label: index.paths.get(entry.id) ?? entry.name,
      }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [tree, extension, keepId])
}

export function EditorSettings({ settings }: { settings: UserSettings }) {
  const { t } = useTranslation()
  return (
    <>
      <SettingsSection>
        <ToggleSetting
          id="autoComplete"
          label={t('auto_complete')}
          description={t('suggests_code_completions_while_typing')}
          checked={settings.autoComplete}
          onChange={autoComplete => updateSettings({ autoComplete })}
        />
        <ToggleSetting
          id="autoPairDelimiters"
          label={t('auto_close_brackets')}
          description={t(
            'automatically_insert_closing_brackets_and_parentheses'
          )}
          checked={settings.autoPairDelimiters}
          onChange={autoPairDelimiters =>
            updateSettings({ autoPairDelimiters })
          }
        />
        <ToggleSetting
          id="nonBlinkingCursor"
          label={t('non_blinking_cursor')}
          description={t(
            'reduces_visual_distraction_by_keeping_the_cursor_solid'
          )}
          checked={settings.nonBlinkingCursor}
          onChange={nonBlinkingCursor => updateSettings({ nonBlinkingCursor })}
        />
        <ToggleSetting
          id="syntaxValidation"
          label={t('syntax_validation')}
          description={t('enables_real_time_syntax_checking_in_the_editor')}
          checked={settings.syntaxValidation}
          onChange={syntaxValidation => updateSettings({ syntaxValidation })}
        />
        <ToggleSetting
          id="editorTabs"
          label={t('open_files_in_tabs')}
          description={t('open_each_file_in_its_own_tab')}
          checked={settings.editorTabs}
          onChange={editorTabs => updateSettings({ editorTabs })}
        />
        <ToggleSetting
          id="previewEditorTabs"
          label={t('preview_editor_tabs')}
          description={t(
            'tabs_open_in_preview_mode_until_you_interact_with_them'
          )}
          checked={settings.previewEditorTabs}
          onChange={previewEditorTabs => updateSettings({ previewEditorTabs })}
          disabled={!settings.editorTabs}
        />
        <DropdownSetting
          id="mode"
          label={t('keybindings')}
          description={t('work_in_vim_or_emacs_emulation_mode')}
          options={KEYBINDING_OPTIONS}
          value={settings.keybindings}
          onChange={keybindings => updateSettings({ keybindings })}
        />
        <DropdownSetting<UserSettings['pdfViewer']>
          id="pdfViewer"
          label={t('pdf_viewer')}
          options={[
            { value: 'pdfjs', label: t('overleaf') },
            { value: 'native', label: t('browser') },
          ]}
          value={settings.pdfViewer}
          onChange={pdfViewer => updateSettings({ pdfViewer })}
          translateOptions="no"
        />
        <ToggleSetting
          id="selectionQuickActions"
          label={t('show_quick_actions_on_text_selection')}
          checked={settings.selectionQuickActions}
          onChange={selectionQuickActions =>
            updateSettings({ selectionQuickActions })
          }
        />
      </SettingsSection>
      <SettingsSection title={t('tools')}>
        <ToggleSetting
          id="breadcrumbs"
          label={t('breadcrumbs')}
          description={t('see_your_current_location_in_the_project')}
          checked={settings.breadcrumbs}
          onChange={breadcrumbs => updateSettings({ breadcrumbs })}
        />
        <ToggleSetting
          id="mathPreview"
          label={t('equation_preview')}
          description={t('show_live_equation_previews_while_typing')}
          checked={settings.mathPreview}
          onChange={mathPreview => updateSettings({ mathPreview })}
        />
      </SettingsSection>
    </>
  )
}

export function SpellingSettings({
  project,
  canWrite,
}: {
  project: ProjectDetails
  canWrite: boolean
}) {
  const { t } = useTranslation()
  return (
    <SettingsSection title={t('spellcheck')}>
      <DropdownSetting
        id="spellCheckLanguage"
        label={t('spellcheck_language')}
        options={[{ value: '', label: t('off') }]}
        optgroups={[
          {
            label: t('language'),
            options: SPELL_LANGUAGES.map(language => ({
              value: language.code,
              label: language.name,
            })),
          },
        ]}
        value={project.spellLanguage}
        onChange={spellLanguage => updateProject(project.id, { spellLanguage })}
        disabled={!canWrite}
        width="wide"
      />
      <Setting
        controlId="dictionary-settings"
        label={t('dictionary')}
        description={t('edit_your_custom_dictionary')}
      >
        <OLButton
          id="dictionary-settings"
          variant="secondary"
          size="sm"
          onClick={openDictionaryModal}
        >
          {t('edit')}
        </OLButton>
      </Setting>
    </SettingsSection>
  )
}

export function CompilerSettings({
  project,
  tree,
  canWrite,
}: {
  project: ProjectDetails
  tree: ProjectTree
  canWrite: boolean
}) {
  const { t } = useTranslation()
  const draft = useCompileStore(s => s.draft)
  const stopOnFirstError = useCompileStore(s => s.stopOnFirstError)
  const autoCompile = useCompileStore(s => s.autoCompile)
  const syntaxCheck = useCompileStore(s => s.syntaxCheck)
  const setOption = useCompileStore(s => s.setOption)
  const texDocs = useDocOptions(tree, '.tex', project.rootDocId ?? undefined)
  const rootDocOptions: Option[] =
    project.rootDocId && texDocs.some(o => o.value === project.rootDocId)
      ? texDocs
      : [{ value: '', label: t('none'), disabled: true }, ...texDocs]

  return (
    <SettingsSection>
      <DropdownSetting
        id="rootDocId"
        label={t('main_document')}
        description={t('the_primary_file_for_compiling_your_project')}
        options={rootDocOptions}
        value={project.rootDocId ?? ''}
        onChange={rootDocId => updateProject(project.id, { rootDocId })}
        disabled={!canWrite}
        width="wide"
        translateOptions="no"
      />
      <DropdownSetting
        id="compiler"
        label={t('compiler')}
        description={t('the_latex_engine_used_for_compiling')}
        options={COMPILER_OPTIONS}
        value={project.compiler}
        onChange={compiler => updateProject(project.id, { compiler })}
        disabled={!canWrite}
        translateOptions="no"
      />
      {project.images.length > 1 && (
        <DropdownSetting
          id="imageName"
          label={t('tex_live_version')}
          description={t('the_version_of_tex_live_used_for_compiling')}
          options={project.images.map(image => ({
            value: image,
            label: image,
          }))}
          value={project.image}
          onChange={image => updateProject(project.id, { image })}
          disabled={!canWrite}
          width="wide"
          translateOptions="no"
        />
      )}
      <DropdownSetting
        id="draft"
        label={t('compile_mode')}
        description={t('switch_compile_mode_for_faster_draft_compilation')}
        options={[
          { value: 'normal', label: t('normal') },
          { value: 'fast_draft', label: t('fast_draft') },
        ]}
        value={draft ? 'fast_draft' : 'normal'}
        onChange={mode => setOption('draft', mode === 'fast_draft')}
      />
      <ToggleSetting
        id="stopOnFirstError"
        label={t('stop_on_first_error')}
        checked={stopOnFirstError}
        onChange={value => setOption('stopOnFirstError', value)}
      />
      <ToggleSetting
        id="syntaxCheck"
        label={t('syntax_check')}
        checked={syntaxCheck}
        onChange={value => setOption('syntaxCheck', value)}
      />
      <ToggleSetting
        id="autoCompile"
        label={t('autocompile')}
        description={t('automatically_recompile_the_project_as_you_edit')}
        checked={autoCompile}
        onChange={value => setOption('autoCompile', value)}
      />
    </SettingsSection>
  )
}

export function ReferenceSettings({
  project,
  tree,
  settings,
  canWrite,
}: {
  project: ProjectDetails
  tree: ProjectTree
  settings: UserSettings
  canWrite: boolean
}) {
  const { t } = useTranslation()
  const bibDocs = useDocOptions(tree, '.bib')
  return (
    <SettingsSection>
      <DropdownSetting
        id="mainBibliographyDocId"
        label={t('main_bibliography_file_for_this_project')}
        description={t('main_bibliography_file_description')}
        options={[{ value: '', label: t('none') }, ...bibDocs]}
        value={project.mainBibDocId ?? ''}
        onChange={id =>
          updateProject(project.id, { mainBibDocId: id === '' ? null : id })
        }
        disabled={!canWrite || bibDocs.length === 0}
        width="wide"
        translateOptions="no"
      />
      <DropdownSetting<UserSettings['referencesSearchMode']>
        id="referencesSearchMode"
        label={t('reference_search_setting')}
        description={t('choose_how_you_search_your_references')}
        options={[
          { value: 'advanced', label: t('advanced_reference_search_mode') },
          { value: 'simple', label: t('simple_search_mode') },
        ]}
        value={settings.referencesSearchMode}
        onChange={referencesSearchMode =>
          updateSettings({ referencesSearchMode })
        }
        width="wide"
      />
    </SettingsSection>
  )
}

export function AppearanceSettings({ settings }: { settings: UserSettings }) {
  const { t } = useTranslation()
  const themeGroups = useEditorThemeOptgroups()
  return (
    <SettingsSection>
      <DropdownSetting<UserSettings['overallTheme']>
        id="overallTheme"
        label={t('overall_theme')}
        options={[
          { value: 'system', label: t('system_default') },
          { value: 'light', label: t('light') },
          { value: 'dark', label: t('dark') },
        ]}
        value={settings.overallTheme}
        onChange={overallTheme => updateSettings({ overallTheme })}
      />
      <DropdownSetting
        id="editorTheme"
        label={t('editor_theme')}
        description={t('the_code_editor_color_scheme')}
        optgroups={themeGroups}
        value={settings.editorTheme}
        onChange={editorTheme => updateSettings({ editorTheme })}
        width="wide"
        translateOptions="no"
      />
      <ToggleSetting
        id="pdfDarkMode"
        label={t('dark_mode_pdf_preview')}
        description={t('invert_pdf_preview_colors_when_in_dark_mode')}
        checked={settings.pdfDarkMode}
        onChange={pdfDarkMode => updateSettings({ pdfDarkMode })}
      />
      <DropdownSetting
        id="fontSize"
        label={t('editor_font_size')}
        options={FONT_SIZE_OPTIONS}
        value={settings.fontSize}
        onChange={fontSize => updateSettings({ fontSize })}
      />
      <DropdownSetting
        id="fontFamily"
        label={t('editor_font_family')}
        options={FONT_FAMILY_OPTIONS}
        value={settings.fontFamily}
        onChange={fontFamily => updateSettings({ fontFamily })}
        width="wide"
        translateOptions="no"
      />
      <DropdownSetting<UserSettings['lineHeight']>
        id="lineHeight"
        label={t('editor_line_height')}
        options={[
          { value: 'compact', label: t('compact') },
          { value: 'normal', label: t('normal') },
          { value: 'wide', label: t('wide') },
        ]}
        value={settings.lineHeight}
        onChange={lineHeight => updateSettings({ lineHeight })}
      />
    </SettingsSection>
  )
}

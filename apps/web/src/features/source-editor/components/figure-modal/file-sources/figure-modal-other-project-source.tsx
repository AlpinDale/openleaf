import { FC, useEffect, useMemo, useState } from 'react'
import { ProjectTree, ProjectSummary } from '@openleaf/shared'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/api/client'
import { useProjects } from '@/api/projects'
import { importFromProject, treeKey } from '@/api/tree'
import { indexTree } from '@/features/file-tree/util/tree-index'
import { Select } from '@/shared/components/select'
import { useFigureModalContext } from '../figure-modal-context'
import { useCurrentProjectFolders } from '../../../hooks/use-current-project-folders'
import { File, isImageEntity } from '../../../utils/file'
import { useProjectContext } from '@/shared/context/project-context'
import { FileRelocator } from '../file-relocator'
import { useTranslation } from '@/i18n'
import { waitForFileTreeUpdate } from '../../../extensions/figure-modal'
import { useCodeMirrorViewContext } from '../../codemirror-context'
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import { replaceOnConflict } from './replace-on-conflict'

type Entity = { id: string; path: string }

/** Projects the user can copy files from (everything but this one and the trash). */
function useUserProjects(currentProjectId: string) {
  const { isLoading, data, error } = useProjects()
  const projects = useMemo(
    () =>
      data?.filter(
        project => project.id !== currentProjectId && !project.trashedAt
      ),
    [data, currentProjectId]
  )
  return { loading: isLoading, data: projects, error: error?.message }
}

/** File entries of another project, with their paths. */
function useProjectEntities(projectId?: string) {
  const { isLoading, data, error } = useQuery({
    queryKey: treeKey(projectId ?? ''),
    enabled: !!projectId,
    queryFn: ({ signal }) =>
      apiFetch(`/projects/${projectId}/tree`, { schema: ProjectTree, signal }),
  })
  const entities = useMemo(() => {
    if (!data) return null
    const index = indexTree(data)
    const files: Entity[] = []
    for (const entry of data.entries) {
      if (entry.kind === 'file')
        files.push({ id: entry.id, path: index.paths.get(entry.id) ?? '' })
    }
    return files
  }, [data])
  return { loading: isLoading, data: entities, error: error?.message }
}

function suggestName(path: string) {
  const parts = path.split('/')
  return parts[parts.length - 1]
}

export const FigureModalOtherProjectSource: FC = () => {
  const { t } = useTranslation()
  const view = useCodeMirrorViewContext()
  const { dispatch } = useFigureModalContext()
  const { projectId } = useProjectContext()
  const {
    loading: projectsLoading,
    data: projects,
    error,
  } = useUserProjects(projectId)
  const [selectedProject, setSelectedProject] = useState<null | ProjectSummary>(
    null
  )
  const [nameDirty, setNameDirty] = useState<boolean>(false)
  const [name, setName] = useState<string>('')
  const [folder, setFolder] = useState<File | null>(null)
  const { rootFile } = useCurrentProjectFolders()
  const [file, setFile] = useState<Entity | null>(null)

  useEffect(() => {
    if (error) {
      dispatch({ error })
    }
  }, [error, dispatch])

  const updateDispatch: (args: {
    newFolder?: File | null
    newName?: string
    newSelectedProject?: ProjectSummary | null
    newFile?: Entity | null
  }) => void = ({
    newFolder = folder,
    newName = name,
    newSelectedProject = selectedProject,
    newFile = file,
  }) => {
    const targetFolder = newFolder ?? rootFile

    if (!newName || !newSelectedProject || !newFile) {
      dispatch({ getPath: undefined })
      return
    }

    dispatch({
      getPath: async () => {
        const fileTreeUpdate = waitForFileTreeUpdate(view)
        await replaceOnConflict(newName, overwrite =>
          importFromProject(
            projectId,
            targetFolder.id,
            newName,
            newSelectedProject.id,
            newFile.id,
            { overwrite }
          )
        )
        await fileTreeUpdate.withTimeout(500)
        return targetFolder.path === '' && targetFolder.name === 'rootFolder'
          ? `${newName}`
          : `${targetFolder.path ? targetFolder.path + '/' : ''}${
              targetFolder.name
            }/${name}`
      },
    })
  }

  return (
    <>
      <OLFormGroup>
        <Select
          items={projects ?? []}
          itemToString={project => (project ? project.name : '')}
          itemToKey={item => item.id}
          defaultText={t('select_a_project_figure_modal')}
          label={t('project_figure_modal')}
          disabled={projectsLoading}
          onSelectedItemChanged={item => {
            const suggestion = nameDirty ? name : ''
            setName(suggestion)
            setSelectedProject(item ?? null)
            setFile(null)
            updateDispatch({
              newSelectedProject: item ?? null,
              newFile: null,
              newName: suggestion,
            })
          }}
        />
      </OLFormGroup>
      <OLFormGroup>
        <SelectFromProject
          projectId={selectedProject?.id}
          onSelectedItemChange={item => {
            const suggestion = nameDirty ? name : suggestName(item?.path ?? '')
            setName(suggestion)
            setFile(item ?? null)
            updateDispatch({
              newFile: item ?? null,
              newName: suggestion,
            })
          }}
        />
      </OLFormGroup>
      <FileRelocator
        folder={folder}
        name={name}
        nameDisabled={!file && !nameDirty}
        onFolderChanged={item => {
          const newFolder = item ?? rootFile
          updateDispatch({ newFolder })
        }}
        onNameChanged={name => updateDispatch({ newName: name })}
        setFolder={setFolder}
        setName={setName}
        setNameDirty={setNameDirty}
      />
    </>
  )
}

const SelectFile = <T extends { path: string }>({
  disabled,
  files,
  onSelectedItemChange,
  defaultText,
  label,
  loading = false,
}: {
  disabled: boolean
  files?: T[] | null
  defaultText?: string
  label?: string
  loading?: boolean
  onSelectedItemChange?: (item: T | null | undefined) => any
}) => {
  const { t } = useTranslation()
  defaultText = defaultText ?? t('select_a_file_figure_modal')
  label = label ?? t('image_file')
  const imageFiles = useMemo(() => files?.filter(isImageEntity), [files])
  const empty = loading || !imageFiles || imageFiles.length === 0
  return (
    <Select
      loading={loading}
      items={imageFiles ?? []}
      itemToString={file => (file ? file.path.replace(/^\//, '') : '')}
      itemToKey={file => file.path}
      defaultText={
        imageFiles?.length === 0 ? t('no_image_files_found') : defaultText
      }
      label={label}
      disabled={disabled || empty}
      onSelectedItemChanged={onSelectedItemChange}
    />
  )
}

const SelectFromProject: FC<{
  projectId?: string
  onSelectedItemChange?: (item: Entity | null | undefined) => any
}> = ({ projectId, onSelectedItemChange }) => {
  const { loading, data: entities, error } = useProjectEntities(projectId)
  const { dispatch } = useFigureModalContext()
  useEffect(() => {
    if (error) {
      dispatch({ error })
    }
  }, [error, dispatch])
  return (
    <SelectFile
      key={projectId}
      files={entities}
      loading={loading}
      disabled={!projectId}
      onSelectedItemChange={onSelectedItemChange}
    />
  )
}

import {
  GitTokenInfo,
  PublicUser,
  type UserSettings,
  type UserSettingsPatch,
  UserSettingsSchema,
} from '@openleaf/shared'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { apiFetch } from './client'
import { queryClient } from './query-client'

export const MeResponse = z.object({
  user: PublicUser,
  settings: UserSettingsSchema,
  learnedWords: z.array(z.string()),
})
export type Me = {
  user: PublicUser
  settings: UserSettings
  learnedWords: string[]
}

const UserResponse = z.object({ user: PublicUser })
const LearnedWordsResponse = z.object({ learnedWords: z.array(z.string()) })
const GitTokensResponse = z.object({ tokens: z.array(GitTokenInfo) })
const CreatedGitToken = z.object({ token: z.string(), info: GitTokenInfo })

export const meKey = ['me'] as const
export const gitTokensKey = ['gitTokens'] as const

export function fetchMe(signal?: AbortSignal): Promise<Me> {
  return apiFetch('/auth/me', { schema: MeResponse, signal })
}

export function useMe() {
  return useQuery({
    queryKey: meKey,
    queryFn: ({ signal }) => fetchMe(signal),
    staleTime: Number.POSITIVE_INFINITY,
  })
}

/** The signed-in user's data; only valid below a component that ensured `useMe` succeeded. */
export function useCurrentMe(): Me {
  const { data } = useMe()
  if (!data) throw new Error('useCurrentMe used before the user was loaded')
  return data
}

async function startSession(path: string, body: unknown) {
  await pendingMePatch.catch(() => {})
  const { user } = await apiFetch(path, {
    method: 'POST',
    body,
    schema: UserResponse,
  })
  // Keep the identity query so mounted observers receive the new session.
  await queryClient.cancelQueries()
  queryClient.removeQueries({ predicate: query => query.queryKey[0] !== 'me' })
  try {
    queryClient.setQueryData(meKey, await fetchMe())
  } catch (err) {
    // A failed refresh must not leave the previous account's data cached.
    queryClient.clear()
    throw err
  }
  return user
}

export function login(email: string, password: string) {
  return startSession('/auth/login', { email, password })
}

export function register(name: string, email: string, password: string) {
  return startSession('/auth/register', { name, email, password })
}

export async function logout() {
  await pendingMePatch.catch(() => {})
  await apiFetch('/auth/logout', { method: 'POST' })
  queryClient.clear()
}

let pendingMePatch: Promise<void> = Promise.resolve()
type MePatch = { name?: string; settings?: UserSettingsPatch }
const queuedMePatches: MePatch[] = []
let confirmedMe: Me | undefined

function renderMePatches() {
  const confirmed = confirmedMe
  if (!confirmed) return
  let user = confirmed.user
  let settings = confirmed.settings
  for (const patch of queuedMePatches) {
    if (patch.name !== undefined) user = { ...user, name: patch.name }
    settings = { ...settings, ...patch.settings }
  }
  queryClient.setQueryData<Me>(meKey, current =>
    current ? { ...current, user, settings } : current
  )
}

/** Updates the name and/or settings, applying the change to `['me']` before the server answers. */
export function patchMe(patch: MePatch): Promise<void> {
  void queryClient.cancelQueries({ queryKey: meKey })
  if (queuedMePatches.length === 0) {
    confirmedMe = queryClient.getQueryData<Me>(meKey)
  }
  queuedMePatches.push(patch)
  renderMePatches()
  const result = pendingMePatch.catch(() => {}).then(() => applyMePatch(patch))
  pendingMePatch = result
  return result
}

async function applyMePatch(patch: MePatch): Promise<void> {
  try {
    const result = await apiFetch('/users/me', {
      method: 'PATCH',
      body: patch,
      schema: z.object({ user: PublicUser, settings: UserSettingsSchema }),
    })
    if (confirmedMe) confirmedMe = { ...confirmedMe, ...result }
  } finally {
    queuedMePatches.shift()
    renderMePatches()
    if (queuedMePatches.length === 0) confirmedMe = undefined
  }
}

export async function changePassword(
  currentPassword: string,
  newPassword: string
) {
  await apiFetch('/users/me/password', {
    method: 'POST',
    body: { currentPassword, newPassword },
  })
}

async function updateLearnedWord(method: 'PUT' | 'DELETE', word: string) {
  const { learnedWords } = await apiFetch(
    `/users/me/learned-words/${encodeURIComponent(word)}`,
    { method, schema: LearnedWordsResponse }
  )
  queryClient.setQueryData<Me>(meKey, current =>
    current ? { ...current, learnedWords } : current
  )
  return learnedWords
}

export function addLearnedWord(word: string) {
  return updateLearnedWord('PUT', word)
}

export function removeLearnedWord(word: string) {
  return updateLearnedWord('DELETE', word)
}

export function useGitTokens() {
  return useQuery({
    queryKey: gitTokensKey,
    queryFn: async ({ signal }) =>
      (
        await apiFetch('/users/me/git-tokens', {
          schema: GitTokensResponse,
          signal,
        })
      ).tokens,
  })
}

/** Creates a Git token; the returned secret is only ever shown once. */
export async function createGitToken(label: string) {
  const result = await apiFetch('/users/me/git-tokens', {
    method: 'POST',
    body: { label },
    schema: CreatedGitToken,
  })
  await queryClient.invalidateQueries({ queryKey: gitTokensKey })
  return result
}

export async function deleteGitToken(id: string) {
  await apiFetch(`/users/me/git-tokens/${id}`, { method: 'DELETE' })
  await queryClient.invalidateQueries({ queryKey: gitTokensKey })
}

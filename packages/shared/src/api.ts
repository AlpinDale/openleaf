import { z } from 'zod'
import { validateEntryName } from './files.js'
import { UserSettingsPatchSchema } from './settings.js'

export const ROLES = ['viewer', 'reviewer', 'editor', 'owner'] as const
export const RoleSchema = z.enum(ROLES)
export type Role = z.infer<typeof RoleSchema>

export function roleAtLeast(role: Role | null | undefined, min: Role): boolean {
  return role != null && ROLES.indexOf(role) >= ROLES.indexOf(min)
}

export type ErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'validation'
  | 'conflict'
  | 'too_large'
  | 'compile_in_progress'
  | 'rate_limited'
  | 'signup_disabled'
  | 'image_unavailable'
  | 'converter_unavailable'
  | 'export_failed'
  | 'internal'

export type ApiErrorBody = {
  error: { code: ErrorCode; message: string; [extra: string]: unknown }
}

// ---- auth / users ----

export const RegisterBody = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  name: z.string().trim().min(1).max(100),
  password: z.string().min(8).max(200),
})
export const LoginBody = z.object({
  email: z.string().trim().toLowerCase(),
  password: z.string().min(1).max(200),
})
export const PublicUser = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
})
export type PublicUser = z.infer<typeof PublicUser>

export const UpdateMeBody = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  settings: UserSettingsPatchSchema.optional(),
})
export const ChangePasswordBody = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8).max(200),
})
export const LearnedWord = z.string().min(1).max(100)

export const GitTokenInfo = z.object({
  id: z.string(),
  label: z.string(),
  createdAt: z.number(),
  lastUsedAt: z.number().nullable(),
})
export type GitTokenInfo = z.infer<typeof GitTokenInfo>
export const CreateGitTokenBody = z.object({
  label: z.string().trim().min(1).max(100),
})

// ---- projects ----

export const COMPILERS = ['pdflatex', 'xelatex', 'lualatex', 'latex'] as const
export const CompilerSchema = z.enum(COMPILERS)
export type Compiler = z.infer<typeof CompilerSchema>

const ProjectName = z.string().trim().min(1).max(150)

export const ProjectSummary = z.object({
  id: z.string(),
  name: z.string(),
  role: RoleSchema,
  updatedAt: z.number(),
  lastOpenedAt: z.number().nullable(),
  archivedAt: z.number().nullable(),
  trashedAt: z.number().nullable(),
  ownerName: z.string(),
})
export type ProjectSummary = z.infer<typeof ProjectSummary>

export const ProjectMember = z.object({
  id: z.string(),
  name: z.string(),
  role: RoleSchema,
})
export type ProjectMember = z.infer<typeof ProjectMember>

export const ProjectDetails = z.object({
  id: z.string(),
  name: z.string(),
  ownerId: z.string(),
  rootDocId: z.string().nullable(),
  compiler: CompilerSchema,
  image: z.string(),
  spellLanguage: z.string(),
  mainBibDocId: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  lastOpenedAt: z.number().nullable(),
  archivedAt: z.number().nullable(),
  trashedAt: z.number().nullable(),
  role: RoleSchema,
  images: z.array(z.string()),
  gitUrl: z.string(),
  limits: z.object({ maxUploadBytes: z.number() }),
  members: z.array(ProjectMember),
})
export type ProjectDetails = z.infer<typeof ProjectDetails>

export const CreateProjectBody = z.object({
  name: ProjectName,
  template: z.enum(['blank', 'example']).default('blank'),
})
export const PatchProjectBody = z.object({
  name: ProjectName.optional(),
  rootDocId: z.string().nullable().optional(),
  compiler: CompilerSchema.optional(),
  image: z.string().optional(),
  spellLanguage: z.string().optional(),
  mainBibDocId: z.string().nullable().optional(),
})
export const CopyProjectBody = z.object({ name: ProjectName })

// ---- file tree ----

export const EntryKindSchema = z.enum(['folder', 'doc', 'file'])
export type EntryKind = z.infer<typeof EntryKindSchema>

export const TreeEntry = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  kind: EntryKindSchema,
  name: z.string(),
  size: z.number(),
  updatedAt: z.number(),
  sourceUrl: z.string().nullable(),
})
export type TreeEntry = z.infer<typeof TreeEntry>

export const ProjectTree = z.object({
  rootFolderId: z.string(),
  entries: z.array(TreeEntry),
})
export type ProjectTree = z.infer<typeof ProjectTree>

const EntryName = z.string().superRefine((name, ctx) => {
  const message = validateEntryName(name)
  if (message) ctx.addIssue({ code: 'custom', message })
})

export const CreateEntryBody = z.object({
  parentId: z.string(),
  name: EntryName,
  kind: z.enum(['folder', 'doc']),
})
export const RenameEntryBody = z.object({ name: EntryName })
export const MoveEntryBody = z.object({ parentId: z.string() })
export const ImportUrlBody = z.object({
  parentId: z.string(),
  name: EntryName,
  url: z.string().trim().min(1).max(2000),
  overwrite: z.boolean().default(false),
})
export const ImportProjectFileBody = z.object({
  parentId: z.string(),
  name: EntryName,
  sourceProjectId: z.string(),
  sourceEntryId: z.string(),
  overwrite: z.boolean().default(false),
})
export const UploadResult = z.object({ entries: z.array(TreeEntry) })

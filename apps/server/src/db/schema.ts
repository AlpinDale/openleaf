import { sql } from 'drizzle-orm'
import {
  type AnySQLiteColumn,
  blob,
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  settingsJson: text('settings_json').notNull().default('{}'),
  createdAt: integer('created_at').notNull(),
})

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  t => [
    index('sessions_user_id_idx').on(t.userId),
    index('sessions_expires_at_idx').on(t.expiresAt),
  ]
)

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  ownerId: text('owner_id')
    .notNull()
    .references(() => users.id),
  rootDocId: text('root_doc_id'),
  compiler: text('compiler').notNull().default('pdflatex'),
  image: text('image').notNull(),
  spellLanguage: text('spell_language').notNull().default('en_US'),
  mainBibDocId: text('main_bib_doc_id'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  lastOpenedAt: integer('last_opened_at'),
  archivedAt: integer('archived_at'),
  trashedAt: integer('trashed_at'),
})

export const projectMembers = sqliteTable(
  'project_members',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', {
      enum: ['owner', 'editor', 'reviewer', 'viewer'],
    }).notNull(),
    createdAt: integer('created_at').notNull(),
  },
  t => [
    primaryKey({ columns: [t.projectId, t.userId] }),
    index('project_members_user_id_idx').on(t.userId),
    check(
      'project_members_role_check',
      sql`${t.role} in ('owner','editor','reviewer','viewer')`
    ),
  ]
)

export const entries = sqliteTable(
  'entries',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    parentId: text('parent_id').references((): AnySQLiteColumn => entries.id, {
      onDelete: 'cascade',
    }),
    kind: text('kind', { enum: ['folder', 'doc', 'file'] }).notNull(),
    name: text('name').notNull(),
    blobHash: text('blob_hash'),
    gitOid: text('git_oid'),
    size: integer('size').notNull().default(0),
    sourceUrl: text('source_url'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  t => [
    uniqueIndex('entries_project_parent_name_idx').on(
      t.projectId,
      t.parentId,
      t.name
    ),
    index('entries_blob_hash_idx').on(t.blobHash),
    check('entries_kind_check', sql`${t.kind} in ('folder','doc','file')`),
  ]
)

export const projectYdocs = sqliteTable('project_ydocs', {
  projectId: text('project_id')
    .primaryKey()
    .references(() => projects.id, { onDelete: 'cascade' }),
  state: blob('state', { mode: 'buffer' }).notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const commentThreads = sqliteTable(
  'comment_threads',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    docId: text('doc_id').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: integer('created_at').notNull(),
    resolvedAt: integer('resolved_at'),
    resolvedBy: text('resolved_by'),
  },
  t => [index('comment_threads_project_id_idx').on(t.projectId)]
)

export const commentMessages = sqliteTable(
  'comment_messages',
  {
    id: text('id').primaryKey(),
    threadId: text('thread_id')
      .notNull()
      .references(() => commentThreads.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    content: text('content').notNull(),
    createdAt: integer('created_at').notNull(),
    editedAt: integer('edited_at'),
  },
  t => [index('comment_messages_thread_id_idx').on(t.threadId)]
)

export const historyLabels = sqliteTable(
  'history_labels',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    commitOid: text('commit_oid').notNull(),
    name: text('name').notNull(),
    userId: text('user_id').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  t => [index('history_labels_project_id_idx').on(t.projectId)]
)

export const gitTokens = sqliteTable(
  'git_tokens',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    createdAt: integer('created_at').notNull(),
    lastUsedAt: integer('last_used_at'),
  },
  t => [index('git_tokens_user_id_idx').on(t.userId)]
)

export const learnedWords = sqliteTable(
  'learned_words',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    word: text('word').notNull(),
  },
  t => [primaryKey({ columns: [t.userId, t.word] })]
)

import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'

// ─── contacts ────────────────────────────────────────────────────────────────

export const contacts = sqliteTable('contacts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  whatsappId: text('whatsapp_id').notNull().unique(), // full JID e.g. 521234567890@s.whatsapp.net
  phone: text('phone').notNull(),
  name: text('name'),          // KAM-set display name; null = use formatted phone
  sheetName: text('sheet_name'), // name pulled from Atlas sheet
  profilePic: text('profile_pic'), // URL from WA
  isGroup: integer('is_group', { mode: 'boolean' }).notNull().default(false),
  participantCount: integer('participant_count'), // for group chats

  // Pipeline
  stage: text('stage', { enum: ['new', 'open_conversation', 'waiting_for', 'all_resolved'] })
    .notNull()
    .default('new'),
  stageChangedAt: integer('stage_changed_at', { mode: 'timestamp_ms' }),

  // Last message summary (denormalized for Kanban performance)
  lastMessage: text('last_message'),
  lastMessageAt: integer('last_message_at', { mode: 'timestamp_ms' }),
  lastMessageDirection: text('last_message_direction', { enum: ['in', 'out'] }),
  unreadCount: integer('unread_count').notNull().default(0),

  // KAM metadata
  property: text('property'),
  notes: text('notes'),

  // Synced from Atlas sheet
  kycStatus: text('kyc_status'),
  contractStatus: text('contract_status'),
  brokerStatus: text('broker_status'),
  opsHistoricas: text('ops_historicas'),
  rentsHistoricas: text('rents_historicas'),
  opsActivas: text('ops_activas'),
  rents3m: text('rents_3m'),
  latestActivityType: text('latest_activity_type'),

  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date())
})

// ─── messages ────────────────────────────────────────────────────────────────

export const messages = sqliteTable('messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  contactId: integer('contact_id').notNull().references(() => contacts.id),
  whatsappMsgId: text('whatsapp_msg_id').notNull().unique(),
  direction: text('direction', { enum: ['in', 'out'] }).notNull(),
  body: text('body'),
  type: text('type', {
    enum: ['text', 'image', 'audio', 'video', 'document', 'sticker', 'location', 'poll', 'reaction', 'deleted', 'unknown']
  }).notNull().default('text'),
  timestamp: integer('timestamp', { mode: 'timestamp_ms' }).notNull(),
  status: text('status', { enum: ['pending', 'sent', 'delivered', 'read', 'failed'] }).default('pending'),

  // Media
  mediaUrl: text('media_url'),
  mediaFilename: text('media_filename'),
  mediaMimetype: text('media_mimetype'),
  mediaSize: integer('media_size'),

  // Edit / delete / reactions
  isEdited: integer('is_edited', { mode: 'boolean' }).notNull().default(false),
  isDeleted: integer('is_deleted', { mode: 'boolean' }).notNull().default(false),
  reactionEmoji: text('reaction_emoji'), // for reaction-type messages
  quotedMsgId: text('quoted_msg_id'),   // message this replies to

  // Ghost-write audit (Phase 2)
  sentByManagerId: text('sent_by_manager_id'),

  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date())
})

// ─── reminders (snooze) ──────────────────────────────────────────────────────

export const reminders = sqliteTable('reminders', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  contactId: integer('contact_id').notNull().references(() => contacts.id),
  dueAt: integer('due_at', { mode: 'timestamp_ms' }).notNull(),
  note: text('note'),
  isDone: integer('is_done', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date())
})

// ─── templates ───────────────────────────────────────────────────────────────

export const templates = sqliteTable('templates', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  body: text('body').notNull(), // may contain {{name}}
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date())
})

// ─── settings ────────────────────────────────────────────────────────────────
// Single-row table (key/value). Anthropic key is stored in Keychain — not here.

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull()
})

// ─── api_usage ───────────────────────────────────────────────────────────────

export const apiUsage = sqliteTable('api_usage', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  month: text('month').notNull(), // 'YYYY-MM'
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date())
})

// ─── types ───────────────────────────────────────────────────────────────────

export type Contact = typeof contacts.$inferSelect
export type InsertContact = typeof contacts.$inferInsert
export type Message = typeof messages.$inferSelect
export type InsertMessage = typeof messages.$inferInsert
export type Reminder = typeof reminders.$inferSelect
export type InsertReminder = typeof reminders.$inferInsert
export type Template = typeof templates.$inferSelect
export type Setting = typeof settings.$inferSelect

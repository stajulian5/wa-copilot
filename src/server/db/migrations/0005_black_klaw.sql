CREATE TABLE `kanban_columns` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`label` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kanban_columns_key_unique` ON `kanban_columns` (`key`);
--> statement-breakpoint
INSERT INTO `kanban_columns` (`key`, `label`, `sort_order`, `created_at`) VALUES
	('new', '🆕 New', 0, unixepoch() * 1000),
	('open_conversation', '💬 Open Conversation', 1, unixepoch() * 1000),
	('waiting_for', '⏳ Waiting For', 2, unixepoch() * 1000),
	('all_resolved', '✅ All Resolved', 3, unixepoch() * 1000);
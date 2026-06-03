CREATE TABLE `accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`jid` text,
	`label` text DEFAULT 'Mi número' NOT NULL,
	`auth_dir` text NOT NULL,
	`is_active` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_jid_unique` ON `accounts` (`jid`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_contacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer DEFAULT 1 NOT NULL,
	`whatsapp_id` text NOT NULL,
	`phone` text,
	`name` text,
	`sheet_name` text,
	`profile_pic` text,
	`is_group` integer DEFAULT false NOT NULL,
	`participant_count` integer,
	`stage` text DEFAULT 'new' NOT NULL,
	`stage_changed_at` integer,
	`last_message` text,
	`last_message_at` integer,
	`last_message_direction` text,
	`last_message_sender_name` text,
	`unread_count` integer DEFAULT 0 NOT NULL,
	`property` text,
	`notes` text,
	`kyc_status` text,
	`contract_status` text,
	`broker_status` text,
	`ops_historicas` text,
	`rents_historicas` text,
	`ops_activas` text,
	`rents_3m` text,
	`latest_activity_type` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_contacts`("id", "account_id", "whatsapp_id", "phone", "name", "sheet_name", "profile_pic", "is_group", "participant_count", "stage", "stage_changed_at", "last_message", "last_message_at", "last_message_direction", "last_message_sender_name", "unread_count", "property", "notes", "kyc_status", "contract_status", "broker_status", "ops_historicas", "rents_historicas", "ops_activas", "rents_3m", "latest_activity_type", "created_at", "updated_at") SELECT "id", 1, "whatsapp_id", "phone", "name", "sheet_name", "profile_pic", "is_group", "participant_count", "stage", "stage_changed_at", "last_message", "last_message_at", "last_message_direction", NULL, "unread_count", "property", "notes", "kyc_status", "contract_status", "broker_status", "ops_historicas", "rents_historicas", "ops_activas", "rents_3m", "latest_activity_type", "created_at", "updated_at" FROM `contacts`;--> statement-breakpoint
DROP TABLE `contacts`;--> statement-breakpoint
ALTER TABLE `__new_contacts` RENAME TO `contacts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `contacts_whatsapp_id_unique` ON `contacts` (`whatsapp_id`);--> statement-breakpoint
ALTER TABLE `messages` ADD `sender_name` text;
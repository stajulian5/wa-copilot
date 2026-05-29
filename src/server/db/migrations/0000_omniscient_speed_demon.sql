CREATE TABLE `api_usage` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`month` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`whatsapp_id` text NOT NULL,
	`phone` text NOT NULL,
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
CREATE UNIQUE INDEX `contacts_whatsapp_id_unique` ON `contacts` (`whatsapp_id`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`contact_id` integer NOT NULL,
	`whatsapp_msg_id` text NOT NULL,
	`direction` text NOT NULL,
	`body` text,
	`type` text DEFAULT 'text' NOT NULL,
	`timestamp` integer NOT NULL,
	`status` text DEFAULT 'pending',
	`media_url` text,
	`media_filename` text,
	`media_mimetype` text,
	`media_size` integer,
	`is_edited` integer DEFAULT false NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`reaction_emoji` text,
	`quoted_msg_id` text,
	`sent_by_manager_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `messages_whatsapp_msg_id_unique` ON `messages` (`whatsapp_msg_id`);--> statement-breakpoint
CREATE TABLE `reminders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`contact_id` integer NOT NULL,
	`due_at` integer NOT NULL,
	`note` text,
	`is_done` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);

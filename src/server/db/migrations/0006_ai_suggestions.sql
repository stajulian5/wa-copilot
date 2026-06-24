CREATE TABLE `ai_suggestions` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `contact_id` integer NOT NULL REFERENCES `contacts`(`id`),
  `suggestion` text NOT NULL,
  `outcome` text,
  `edited_text` text,
  `generated_at` integer NOT NULL,
  `resolved_at` integer
);

CREATE TABLE `pr_suggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`host` text NOT NULL,
	`owner` text NOT NULL,
	`repo` text NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`author` text NOT NULL,
	`url` text NOT NULL,
	`updated_at` text NOT NULL,
	`recent_repo` integer NOT NULL,
	`known_author` integer NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`dismissed_at` text
);
--> statement-breakpoint
CREATE INDEX `pr_suggestions_host_idx` ON `pr_suggestions` (`host`);
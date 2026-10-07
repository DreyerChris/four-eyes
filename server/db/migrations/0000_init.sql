CREATE TABLE `chunk_hunks` (
	`chunk_id` text NOT NULL,
	`hunk_id` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`chunk_id`, `hunk_id`),
	FOREIGN KEY (`chunk_id`) REFERENCES `chunks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`hunk_id`) REFERENCES `hunks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chunk_hunks_hunk_idx` ON `chunk_hunks` (`hunk_id`);--> statement-breakpoint
CREATE TABLE `chunk_progress` (
	`chunk_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`note` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`chunk_id`) REFERENCES `chunks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`round_id` text NOT NULL,
	`position` integer NOT NULL,
	`title` text NOT NULL,
	`explanation` text NOT NULL,
	`kind` text NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chunks_review_idx` ON `chunks` (`review_id`);--> statement-breakpoint
CREATE TABLE `claude_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`kind` text NOT NULL,
	`model` text NOT NULL,
	`status` text NOT NULL,
	`session_id` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`cost_usd` real,
	`error` text,
	`started_at` text NOT NULL,
	`finished_at` text,
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `claude_runs_review_idx` ON `claude_runs` (`review_id`);--> statement-breakpoint
CREATE TABLE `finding_hunks` (
	`finding_id` text NOT NULL,
	`hunk_id` text NOT NULL,
	PRIMARY KEY(`finding_id`, `hunk_id`),
	FOREIGN KEY (`finding_id`) REFERENCES `findings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`hunk_id`) REFERENCES `hunks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `findings` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`round_id` text NOT NULL,
	`severity` text NOT NULL,
	`title` text NOT NULL,
	`explanation` text NOT NULL,
	`suggested_fix` text,
	`lifecycle` text NOT NULL,
	`user_verdict` text,
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `findings_review_idx` ON `findings` (`review_id`);--> statement-breakpoint
CREATE TABLE `hunks` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`round_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`file_path` text NOT NULL,
	`old_file_path` text,
	`change_type` text NOT NULL,
	`old_start` integer NOT NULL,
	`old_lines` integer NOT NULL,
	`new_start` integer NOT NULL,
	`new_lines` integer NOT NULL,
	`patch_text` text NOT NULL,
	`position` integer NOT NULL,
	`present` integer NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `hunks_review_idx` ON `hunks` (`review_id`);--> statement-breakpoint
CREATE INDEX `hunks_fingerprint_idx` ON `hunks` (`review_id`,`fingerprint`);--> statement-breakpoint
CREATE TABLE `questions` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`chunk_id` text,
	`file_path` text,
	`start_line` integer,
	`end_line` integer,
	`selected_text` text,
	`head_sha` text NOT NULL,
	`question` text NOT NULL,
	`answer` text,
	`model` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chunk_id`) REFERENCES `chunks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `questions_review_idx` ON `questions` (`review_id`);--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`host` text NOT NULL,
	`owner` text NOT NULL,
	`repo` text NOT NULL,
	`pr_number` integer NOT NULL,
	`title` text NOT NULL,
	`author` text NOT NULL,
	`url` text NOT NULL,
	`base_sha` text NOT NULL,
	`head_sha` text NOT NULL,
	`gh_state` text NOT NULL,
	`status` text NOT NULL,
	`pipeline_status` text NOT NULL,
	`pipeline_error` text,
	`worktree_path` text,
	`qa_session_id` text,
	`remote_head_sha` text,
	`remote_checked_at` text,
	`created_at` text NOT NULL,
	`last_activity_at` text NOT NULL,
	`finished_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reviews_pr_unique` ON `reviews` (`host`,`owner`,`repo`,`pr_number`);--> statement-breakpoint
CREATE TABLE `rounds` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`number` integer NOT NULL,
	`head_sha` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rounds_review_number_unique` ON `rounds` (`review_id`,`number`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `verdicts` (
	`review_id` text NOT NULL,
	`round_id` text NOT NULL,
	`summary` text NOT NULL,
	`suggestion` text NOT NULL,
	PRIMARY KEY(`review_id`, `round_id`),
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE `filesystem_access_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`mode` text DEFAULT 'selected' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "filesystem_access_settings_mode_check" CHECK("filesystem_access_settings"."mode" IN ('read_only', 'selected', 'full'))
);
--> statement-breakpoint
CREATE TABLE `filesystem_roots` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`label` text NOT NULL,
	`path` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`source` text DEFAULT 'user' NOT NULL,
	`source_project_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`revoked_at` text,
	CONSTRAINT "filesystem_roots_status_check" CHECK("filesystem_roots"."status" IN ('active', 'missing', 'revoked')),
	CONSTRAINT "filesystem_roots_source_check" CHECK("filesystem_roots"."source" IN ('user', 'legacy_project'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `filesystem_roots_user_path_idx` ON `filesystem_roots` (`user_id`,`path`);--> statement-breakpoint
CREATE INDEX `filesystem_roots_user_status_idx` ON `filesystem_roots` (`user_id`,`status`);--> statement-breakpoint
CREATE TABLE `turn_filesystem_authorizations` (
	`id` text PRIMARY KEY NOT NULL,
	`turn_id` text NOT NULL,
	`user_id` text NOT NULL,
	`mode` text NOT NULL,
	`revision` integer NOT NULL,
	`roots_json` text NOT NULL,
	`working_root_path` text,
	`created_at` text NOT NULL,
	CONSTRAINT "turn_filesystem_authorizations_mode_check" CHECK("turn_filesystem_authorizations"."mode" IN ('read_only', 'selected', 'full'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `turn_filesystem_authorizations_turn_idx` ON `turn_filesystem_authorizations` (`turn_id`);--> statement-breakpoint
CREATE INDEX `turn_filesystem_authorizations_user_created_idx` ON `turn_filesystem_authorizations` (`user_id`,`created_at`);

CREATE TABLE `conversation_task_projections` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`task_id` text NOT NULL,
	`position` integer NOT NULL,
	`reason` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "conversation_task_projections_position_check" CHECK("conversation_task_projections"."position" > 0),
	CONSTRAINT "conversation_task_projections_reason_check" CHECK("conversation_task_projections"."reason" IN ('origin', 'goal_home', 'legacy_bridge'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conversation_task_projections_task_idx` ON `conversation_task_projections` (`conversation_id`,`task_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `conversation_task_projections_position_idx` ON `conversation_task_projections` (`conversation_id`,`position`);--> statement-breakpoint
CREATE INDEX `conversation_task_projections_work_task_idx` ON `conversation_task_projections` (`task_id`);--> statement-breakpoint
CREATE TABLE `work_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`source_runtime` text NOT NULL,
	`source_message_id` text NOT NULL,
	`role` text NOT NULL,
	`source_created_at` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "work_messages_source_runtime_check" CHECK("work_messages"."source_runtime" IN ('classic', 'v2_flow'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `work_messages_source_idx` ON `work_messages` (`source_runtime`,`source_message_id`);--> statement-breakpoint
CREATE INDEX `work_messages_task_created_idx` ON `work_messages` (`task_id`,`source_created_at`);--> statement-breakpoint
CREATE TABLE `work_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`goal_id` text,
	`source_runtime` text NOT NULL,
	`source_turn_id` text NOT NULL,
	`started_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`metadata_json` text,
	CONSTRAINT "work_tasks_source_runtime_check" CHECK("work_tasks"."source_runtime" IN ('classic', 'v2_flow'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `work_tasks_source_idx` ON `work_tasks` (`source_runtime`,`source_turn_id`);--> statement-breakpoint
CREATE INDEX `work_tasks_goal_started_idx` ON `work_tasks` (`goal_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `work_tasks_project_started_idx` ON `work_tasks` (`project_id`,`started_at`);
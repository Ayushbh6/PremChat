PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `global_socrates_state` (
	`id` text PRIMARY KEY NOT NULL,
	`foreground_goal_id` text,
	`active_task_id` text,
	`revision` integer DEFAULT 0 NOT NULL,
	`last_event_sequence` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`metadata_json` text,
	CONSTRAINT "global_socrates_state_revision_check" CHECK("global_socrates_state"."revision" >= 0),
	CONSTRAINT "global_socrates_state_event_sequence_check" CHECK("global_socrates_state"."last_event_sequence" >= 0)
);
--> statement-breakpoint
INSERT INTO `global_socrates_state` (
	`id`, `foreground_goal_id`, `active_task_id`, `revision`, `last_event_sequence`, `created_at`, `updated_at`, `metadata_json`
)
SELECT
	'global',
	(
		SELECT `id`
		FROM `v2_goals`
		WHERE `status` = 'foreground'
		ORDER BY `last_active_at` DESC, `id` ASC
		LIMIT 1
	),
	(
		SELECT `work_tasks`.`id`
		FROM `work_tasks`
		LEFT JOIN `v2_agent_tasks` ON `v2_agent_tasks`.`root_turn_id` = `work_tasks`.`source_turn_id`
		LEFT JOIN `agent_tasks` ON `agent_tasks`.`root_turn_id` = `work_tasks`.`source_turn_id`
		WHERE `v2_agent_tasks`.`status` IN ('running', 'waiting', 'ready')
		   OR `agent_tasks`.`status` IN ('running', 'waiting', 'ready')
		ORDER BY `work_tasks`.`updated_at` DESC, `work_tasks`.`id` ASC
		LIMIT 1
	),
	COALESCE((SELECT MAX(`revision`) FROM `v2_flows`), 0),
	0,
	COALESCE((SELECT MIN(`created_at`) FROM `v2_flows`), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	COALESCE((SELECT MAX(`updated_at`) FROM `v2_flows`), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	json_object(
		'migrationVersion', 1,
		'legacyFlowCount', (SELECT COUNT(*) FROM `v2_flows`),
		'migratedAt', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
	);
--> statement-breakpoint
UPDATE `v2_goals`
SET `metadata_json` = json_set(
	COALESCE(`metadata_json`, '{}'),
	'$.legacyFlowId', `flow_id`,
	'$.legacyProjectId', `project_id`
);
--> statement-breakpoint
UPDATE `work_tasks`
SET `metadata_json` = json_set(
	COALESCE(`metadata_json`, '{}'),
	'$.legacySourceRuntime', `source_runtime`,
	'$.legacyProjectId', `project_id`,
	'$.legacyFlowId', COALESCE(
		(SELECT `flow_id` FROM `v2_turns` WHERE `v2_turns`.`id` = `work_tasks`.`source_turn_id` LIMIT 1),
		(SELECT `flow_id` FROM `v2_classic_turn_goal_links` WHERE `v2_classic_turn_goal_links`.`turn_id` = `work_tasks`.`source_turn_id` LIMIT 1)
	)
);
--> statement-breakpoint
UPDATE `v2_goals`
SET `status` = 'parked'
WHERE `status` = 'foreground'
	AND `id` <> COALESCE((SELECT `foreground_goal_id` FROM `global_socrates_state` WHERE `id` = 'global'), '');
--> statement-breakpoint
DROP INDEX IF EXISTS `v2_goals_flow_ordinal_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `v2_goals_flow_status_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `v2_goals_project_status_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `v2_goals_one_foreground_idx`;
--> statement-breakpoint
WITH `ranked` AS (
	SELECT `id`, ROW_NUMBER() OVER (ORDER BY `created_at` ASC, `id` ASC) AS `next_ordinal`
	FROM `v2_goals`
)
UPDATE `v2_goals`
SET `ordinal` = (SELECT `next_ordinal` FROM `ranked` WHERE `ranked`.`id` = `v2_goals`.`id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_goals_ordinal_idx` ON `v2_goals` (`ordinal`);
--> statement-breakpoint
CREATE INDEX `v2_goals_status_idx` ON `v2_goals` (`status`,`last_active_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_goals_one_foreground_idx` ON `v2_goals` (`status`) WHERE `status` = 'foreground';
--> statement-breakpoint
DROP INDEX IF EXISTS `v2_goal_transitions_flow_sequence_idx`;
--> statement-breakpoint
WITH `ranked` AS (
	SELECT `id`, ROW_NUMBER() OVER (ORDER BY `created_at` ASC, `id` ASC) AS `next_sequence`
	FROM `v2_goal_transitions`
)
UPDATE `v2_goal_transitions`
SET `sequence` = (SELECT `next_sequence` FROM `ranked` WHERE `ranked`.`id` = `v2_goal_transitions`.`id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_goal_transitions_sequence_idx` ON `v2_goal_transitions` (`sequence`);
--> statement-breakpoint
DROP INDEX IF EXISTS `v2_turns_flow_ordinal_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `v2_turns_flow_status_idx`;
--> statement-breakpoint
WITH `ranked` AS (
	SELECT `id`, ROW_NUMBER() OVER (ORDER BY `started_at` ASC, `id` ASC) AS `next_ordinal`
	FROM `v2_turns`
)
UPDATE `v2_turns`
SET `ordinal` = (SELECT `next_ordinal` FROM `ranked` WHERE `ranked`.`id` = `v2_turns`.`id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_turns_ordinal_idx` ON `v2_turns` (`ordinal`);
--> statement-breakpoint
CREATE INDEX `v2_turns_status_idx` ON `v2_turns` (`status`,`started_at`);
--> statement-breakpoint
DROP INDEX IF EXISTS `v2_messages_flow_ordinal_idx`;
--> statement-breakpoint
WITH `ranked` AS (
	SELECT `id`, ROW_NUMBER() OVER (ORDER BY `created_at` ASC, `id` ASC) AS `next_ordinal`
	FROM `v2_messages`
)
UPDATE `v2_messages`
SET `ordinal` = (SELECT `next_ordinal` FROM `ranked` WHERE `ranked`.`id` = `v2_messages`.`id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_messages_ordinal_idx` ON `v2_messages` (`ordinal`);
--> statement-breakpoint
DROP INDEX IF EXISTS `v2_runtime_events_flow_sequence_idx`;
--> statement-breakpoint
WITH `ranked` AS (
	SELECT `id`, ROW_NUMBER() OVER (ORDER BY `created_at` ASC, `id` ASC) AS `next_sequence`
	FROM `v2_runtime_events`
)
UPDATE `v2_runtime_events`
SET `sequence` = (SELECT `next_sequence` FROM `ranked` WHERE `ranked`.`id` = `v2_runtime_events`.`id`);
--> statement-breakpoint
CREATE TABLE `__new_v2_runtime_events` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`goal_id` text,
	`turn_id` text,
	`sequence` integer NOT NULL,
	`type` text NOT NULL,
	`source` text NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "v2_runtime_events_sequence_check" CHECK("__new_v2_runtime_events"."sequence" > 0),
	CONSTRAINT "v2_runtime_events_type_check" CHECK("__new_v2_runtime_events"."type" LIKE 'socrates.%')
);
--> statement-breakpoint
INSERT INTO `__new_v2_runtime_events` (`id`, `project_id`, `goal_id`, `turn_id`, `sequence`, `type`, `source`, `payload_json`, `created_at`)
SELECT `id`, `project_id`, `goal_id`, `turn_id`, `sequence`,
	CASE WHEN `type` LIKE 'v2.%' THEN 'socrates.' || substr(`type`, 4) ELSE `type` END,
	`source`, `payload_json`, `created_at`
FROM `v2_runtime_events`;
--> statement-breakpoint
DROP TABLE `v2_runtime_events`;
--> statement-breakpoint
ALTER TABLE `__new_v2_runtime_events` RENAME TO `v2_runtime_events`;
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_runtime_events_sequence_idx` ON `v2_runtime_events` (`sequence`);
--> statement-breakpoint
CREATE INDEX `v2_runtime_events_project_sequence_idx` ON `v2_runtime_events` (`project_id`,`sequence`);
--> statement-breakpoint
CREATE INDEX `v2_runtime_events_goal_sequence_idx` ON `v2_runtime_events` (`goal_id`,`sequence`);
--> statement-breakpoint
CREATE INDEX `v2_runtime_events_turn_sequence_idx` ON `v2_runtime_events` (`turn_id`,`sequence`);
--> statement-breakpoint
CREATE INDEX `v2_runtime_events_type_idx` ON `v2_runtime_events` (`type`);
--> statement-breakpoint
UPDATE `global_socrates_state`
SET `last_event_sequence` = COALESCE((SELECT MAX(`sequence`) FROM `v2_runtime_events`), 0)
WHERE `id` = 'global';
--> statement-breakpoint
CREATE TABLE `__new_work_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`goal_id` text,
	`source_runtime` text NOT NULL,
	`source_turn_id` text NOT NULL,
	`access_snapshot_id` text,
	`working_root_path` text,
	`started_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`metadata_json` text,
	CONSTRAINT "work_tasks_source_runtime_check" CHECK("__new_work_tasks"."source_runtime" = 'socrates')
);
--> statement-breakpoint
INSERT INTO `__new_work_tasks` (
	`id`, `project_id`, `goal_id`, `source_runtime`, `source_turn_id`, `access_snapshot_id`, `working_root_path`, `started_at`, `created_at`, `updated_at`, `metadata_json`
)
SELECT
	`id`,
	`project_id`,
	`goal_id`,
	'socrates',
	`source_turn_id`,
	(SELECT `id` FROM `turn_filesystem_authorizations` WHERE `turn_id` = `work_tasks`.`source_turn_id` LIMIT 1),
	(SELECT `working_root_path` FROM `turn_filesystem_authorizations` WHERE `turn_id` = `work_tasks`.`source_turn_id` LIMIT 1),
	`started_at`,
	`created_at`,
	`updated_at`,
	`metadata_json`
FROM `work_tasks`;
--> statement-breakpoint
DROP TABLE `work_tasks`;
--> statement-breakpoint
ALTER TABLE `__new_work_tasks` RENAME TO `work_tasks`;
--> statement-breakpoint
CREATE UNIQUE INDEX `work_tasks_source_idx` ON `work_tasks` (`source_runtime`,`source_turn_id`);
--> statement-breakpoint
CREATE INDEX `work_tasks_goal_started_idx` ON `work_tasks` (`goal_id`,`started_at`);
--> statement-breakpoint
CREATE INDEX `work_tasks_project_started_idx` ON `work_tasks` (`project_id`,`started_at`);
--> statement-breakpoint
CREATE TABLE `__new_work_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`source_runtime` text NOT NULL,
	`source_message_id` text NOT NULL,
	`role` text NOT NULL,
	`source_created_at` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "work_messages_source_runtime_check" CHECK("__new_work_messages"."source_runtime" = 'socrates')
);
--> statement-breakpoint
INSERT INTO `__new_work_messages` (`id`, `task_id`, `source_runtime`, `source_message_id`, `role`, `source_created_at`, `created_at`)
SELECT `id`, `task_id`, 'socrates', `source_message_id`, `role`, `source_created_at`, `created_at`
FROM `work_messages`;
--> statement-breakpoint
DROP TABLE `work_messages`;
--> statement-breakpoint
ALTER TABLE `__new_work_messages` RENAME TO `work_messages`;
--> statement-breakpoint
CREATE UNIQUE INDEX `work_messages_source_idx` ON `work_messages` (`source_runtime`,`source_message_id`);
--> statement-breakpoint
CREATE INDEX `work_messages_task_created_idx` ON `work_messages` (`task_id`,`source_created_at`);
--> statement-breakpoint
DROP TRIGGER IF EXISTS `v2_evidence_items_no_delete`;
--> statement-breakpoint
CREATE TABLE `__new_v2_deletion_authorizations` (
	`id` text PRIMARY KEY NOT NULL,
	`target_kind` text NOT NULL,
	`target_id` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "v2_deletion_authorizations_target_kind_check" CHECK("__new_v2_deletion_authorizations"."target_kind" IN ('turn', 'goal', 'task'))
);
--> statement-breakpoint
INSERT INTO `__new_v2_deletion_authorizations` (`id`, `target_kind`, `target_id`, `created_at`)
SELECT `id`, `target_kind`, `target_id`, `created_at`
FROM `v2_deletion_authorizations`
WHERE `target_kind` <> 'flow';
--> statement-breakpoint
DROP TABLE `v2_deletion_authorizations`;
--> statement-breakpoint
ALTER TABLE `__new_v2_deletion_authorizations` RENAME TO `v2_deletion_authorizations`;
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_deletion_authorizations_target_idx` ON `v2_deletion_authorizations` (`target_kind`,`target_id`);
--> statement-breakpoint
DROP INDEX IF EXISTS `v2_agent_tasks_flow_status_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `v2_approvals_flow_status_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `v2_artifacts_flow_created_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `v2_classic_bridges_flow_status_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `v2_context_dispositions_flow_created_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `v2_context_items_flow_state_rank_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `v2_credential_input_requests_flow_status_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `v2_errors_flow_created_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `v2_evidence_items_flow_created_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `v2_evidence_items_content_hash_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `v2_feedback_flow_created_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `v2_goal_capsules_flow_created_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `v2_goal_classic_homes_flow_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `v2_goal_message_links_flow_created_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `v2_goal_routing_runs_flow_started_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `v2_message_attachments_flow_created_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `v2_model_calls_flow_started_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `v2_speech_jobs_flow_status_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `v2_terminal_output_chunks_flow_created_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `v2_terminal_sessions_flow_status_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `v2_tool_calls_flow_status_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `v2_turn_runtime_configs_flow_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `v2_usage_events_flow_created_idx`;
--> statement-breakpoint
ALTER TABLE `v2_agent_tasks` DROP COLUMN `flow_id`;
--> statement-breakpoint
ALTER TABLE `v2_approvals` DROP COLUMN `flow_id`;
--> statement-breakpoint
ALTER TABLE `v2_artifacts` DROP COLUMN `flow_id`;
--> statement-breakpoint
ALTER TABLE `v2_classic_conversation_bridges` DROP COLUMN `flow_id`;
--> statement-breakpoint
ALTER TABLE `v2_classic_turn_goal_links` DROP COLUMN `flow_id`;
--> statement-breakpoint
ALTER TABLE `v2_context_dispositions` DROP COLUMN `flow_id`;
--> statement-breakpoint
ALTER TABLE `v2_context_items` DROP COLUMN `flow_id`;
--> statement-breakpoint
ALTER TABLE `v2_credential_input_requests` DROP COLUMN `flow_id`;
--> statement-breakpoint
ALTER TABLE `v2_errors` DROP COLUMN `flow_id`;
--> statement-breakpoint
ALTER TABLE `v2_evidence_items` DROP COLUMN `flow_id`;
--> statement-breakpoint
ALTER TABLE `v2_feedback` DROP COLUMN `flow_id`;
--> statement-breakpoint
ALTER TABLE `v2_goal_capsules` DROP COLUMN `flow_id`;
--> statement-breakpoint
ALTER TABLE `v2_goal_classic_homes` DROP COLUMN `flow_id`;
--> statement-breakpoint
ALTER TABLE `v2_goal_message_links` DROP COLUMN `flow_id`;
--> statement-breakpoint
ALTER TABLE `v2_goal_routing_runs` DROP COLUMN `flow_id`;
--> statement-breakpoint
ALTER TABLE `v2_goal_transitions` DROP COLUMN `flow_id`;
--> statement-breakpoint
ALTER TABLE `v2_goals` DROP COLUMN `flow_id`;
--> statement-breakpoint
ALTER TABLE `v2_goals` DROP COLUMN `project_id`;
--> statement-breakpoint
ALTER TABLE `v2_message_attachments` DROP COLUMN `flow_id`;
--> statement-breakpoint
ALTER TABLE `v2_messages` DROP COLUMN `flow_id`;
--> statement-breakpoint
ALTER TABLE `v2_model_calls` DROP COLUMN `flow_id`;
--> statement-breakpoint
ALTER TABLE `v2_speech_jobs` DROP COLUMN `flow_id`;
--> statement-breakpoint
ALTER TABLE `v2_terminal_output_chunks` DROP COLUMN `flow_id`;
--> statement-breakpoint
ALTER TABLE `v2_terminal_sessions` DROP COLUMN `flow_id`;
--> statement-breakpoint
ALTER TABLE `v2_tool_calls` DROP COLUMN `flow_id`;
--> statement-breakpoint
ALTER TABLE `v2_turn_runtime_configs` DROP COLUMN `flow_id`;
--> statement-breakpoint
ALTER TABLE `v2_turns` DROP COLUMN `flow_id`;
--> statement-breakpoint
ALTER TABLE `v2_usage_events` DROP COLUMN `flow_id`;
--> statement-breakpoint
UPDATE `projects`
SET `metadata_json` = CASE
	WHEN json_remove(COALESCE(`metadata_json`, '{}'), '$.internalGlobalCompatibilityProject') = '{}' THEN NULL
	ELSE json_remove(COALESCE(`metadata_json`, '{}'), '$.internalGlobalCompatibilityProject')
END
WHERE json_type(`metadata_json`, '$.internalGlobalCompatibilityProject') IS NOT NULL;
--> statement-breakpoint
DROP TABLE `v2_flows`;
--> statement-breakpoint
CREATE INDEX `v2_agent_tasks_status_idx` ON `v2_agent_tasks` (`status`,`updated_at`);
--> statement-breakpoint
CREATE INDEX `v2_approvals_status_idx` ON `v2_approvals` (`status`,`requested_at`);
--> statement-breakpoint
CREATE INDEX `v2_artifacts_created_idx` ON `v2_artifacts` (`created_at`);
--> statement-breakpoint
CREATE INDEX `v2_classic_bridges_status_idx` ON `v2_classic_conversation_bridges` (`status`,`updated_at`);
--> statement-breakpoint
CREATE INDEX `v2_context_dispositions_created_idx` ON `v2_context_dispositions` (`created_at`);
--> statement-breakpoint
CREATE INDEX `v2_context_items_state_rank_idx` ON `v2_context_items` (`state`,`rank`);
--> statement-breakpoint
CREATE INDEX `v2_credential_input_requests_status_idx` ON `v2_credential_input_requests` (`status`,`requested_at`);
--> statement-breakpoint
CREATE INDEX `v2_errors_created_idx` ON `v2_errors` (`created_at`);
--> statement-breakpoint
CREATE INDEX `v2_evidence_items_created_idx` ON `v2_evidence_items` (`created_at`);
--> statement-breakpoint
CREATE INDEX `v2_evidence_items_content_hash_idx` ON `v2_evidence_items` (`content_hash`);
--> statement-breakpoint
CREATE INDEX `v2_feedback_created_idx` ON `v2_feedback` (`created_at`);
--> statement-breakpoint
CREATE INDEX `v2_goal_capsules_created_idx` ON `v2_goal_capsules` (`created_at`);
--> statement-breakpoint
CREATE INDEX `v2_goal_message_links_created_idx` ON `v2_goal_message_links` (`created_at`);
--> statement-breakpoint
CREATE INDEX `v2_goal_routing_runs_started_idx` ON `v2_goal_routing_runs` (`started_at`);
--> statement-breakpoint
CREATE INDEX `v2_message_attachments_created_idx` ON `v2_message_attachments` (`created_at`);
--> statement-breakpoint
CREATE INDEX `v2_model_calls_started_idx` ON `v2_model_calls` (`started_at`);
--> statement-breakpoint
CREATE INDEX `v2_speech_jobs_status_idx` ON `v2_speech_jobs` (`status`,`created_at`);
--> statement-breakpoint
CREATE INDEX `v2_terminal_output_chunks_created_idx` ON `v2_terminal_output_chunks` (`created_at`);
--> statement-breakpoint
CREATE INDEX `v2_terminal_sessions_status_idx` ON `v2_terminal_sessions` (`status`,`updated_at`);
--> statement-breakpoint
CREATE INDEX `v2_tool_calls_status_idx` ON `v2_tool_calls` (`status`,`started_at`);
--> statement-breakpoint
CREATE INDEX `v2_usage_events_created_idx` ON `v2_usage_events` (`created_at`);
--> statement-breakpoint
CREATE TRIGGER `v2_evidence_items_no_delete`
BEFORE DELETE ON `v2_evidence_items`
WHEN NOT EXISTS (
	SELECT 1
	FROM `v2_deletion_authorizations`
	WHERE (`target_kind` = 'turn' AND `target_id` = OLD.`turn_id`)
		OR (`target_kind` = 'goal' AND `target_id` = OLD.`goal_id`)
)
BEGIN
	SELECT RAISE(ABORT, 'Socrates evidence is immutable');
END;
--> statement-breakpoint
PRAGMA foreign_keys=ON;

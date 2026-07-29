ALTER TABLE `turns` ADD `ordinal` integer;
--> statement-breakpoint
UPDATE `turns`
SET `ordinal` = (
  SELECT COUNT(*)
  FROM `turns` AS `prior`
  WHERE `prior`.`conversation_id` = `turns`.`conversation_id`
    AND (
      `prior`.`started_at` < `turns`.`started_at`
      OR (`prior`.`started_at` = `turns`.`started_at` AND `prior`.`id` <= `turns`.`id`)
    )
);
--> statement-breakpoint
CREATE UNIQUE INDEX `turns_conversation_ordinal_idx` ON `turns` (`conversation_id`,`ordinal`);

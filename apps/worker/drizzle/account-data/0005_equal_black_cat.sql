CREATE TABLE `source_trace_contexts` (
	`source_record_id` text NOT NULL,
	`trace_id` text NOT NULL,
	PRIMARY KEY(`source_record_id`, `trace_id`),
	FOREIGN KEY (`source_record_id`) REFERENCES `source_records`(`id`) ON UPDATE no action ON DELETE cascade
);

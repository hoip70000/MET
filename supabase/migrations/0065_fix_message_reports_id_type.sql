-- Bug: message_reports.message_id was declared bigint (a leftover assumption from Telegram's
-- numeric message ids elsewhere in this schema), but team_messages/direct_messages both use a
-- uuid primary key — every real report insert failed with
-- "invalid input syntax for type bigint: <uuid>". No real report rows exist yet (the feature
-- just shipped), so this is a plain type change, not a data migration.
alter table public.message_reports alter column message_id type uuid using message_id::text::uuid;

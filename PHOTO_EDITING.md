# Photo editing

Deploy `supabase/migrations/20260924020000_validate_photo_edits.sql` before the updated frontend. This development change does not apply migrations to the hosted database.

Owners can use Edit on My Photos cards to change the name and Private/Public visibility. The dialog shares name/privacy controls with Edit Video. Save updates the existing photo record and replaces it in the current list; Cancel makes no request. The existing quick privacy toggle remains available.

As with video edits, photo renames change `file_name`, not storage keys. The original extension is taken from the stored original and retained automatically. IDs, original/preview/thumbnail paths, and existing references remain unchanged. Public/private access continues to use the existing photo and image-storage policies; editing remains owner-only under database RLS.

The migration adds a trigger for uploads and renames. It rejects empty names, control characters, path separators, reserved filename characters/device names, leading dots, trailing dots/spaces, and names exceeding 255 UTF-8 bytes. It normalizes the suffix to the stored original extension and rejects case-insensitive conflicts within the owner's library. A unique index prevents concurrent new uploads/renames from creating a conflict. Existing duplicate names are not modified; privacy-only edits remain possible, while future renames must choose a free name. Clients cannot clear the uniqueness key to bypass the index.

Frontend type checking, lint, and compilation can be performed without a live database. Runtime permission, conflict, and photo-preview checks require applying the migration to a development Supabase instance; they have not been run for this change.

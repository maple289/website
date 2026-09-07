/*
# Create user-images storage bucket

## Purpose
The user-images bucket was referenced in code and RLS policies but never
actually created in the database. Preview images for videos and all photo
storage depend on this bucket existing.

## Changes
- Create the `user-images` storage bucket (private, not public).
*/

INSERT INTO storage.buckets (id, name, public)
VALUES ('user-images', 'user-images', false)
ON CONFLICT (id) DO NOTHING;

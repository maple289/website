import { supabase } from './supabase';
import type { FileEntry, FileMetadata } from './fileTree';
export type FileOperationPlan = { source: string; destination: string; copy: boolean; restore?: boolean; preserveTrash?: FileOperationPlan; objects: string[]; metadata: FileMetadata[]; done: Set<string>; metadataDone: Set<string> };
type ServerPlan = Omit<FileOperationPlan, 'done' | 'metadataDone' | 'preserveTrash'> & { preserveTrash?: ServerPlan };
const preparePlan = (plan: ServerPlan): FileOperationPlan => ({ ...plan, done: new Set(), metadataDone: new Set(), preserveTrash: plan.preserveTrash ? preparePlan(plan.preserveTrash) : undefined });
export async function planFileOperation(entry: FileEntry, destination: string, copy: boolean, restore = false): Promise<FileOperationPlan | null> {
  const { data, error } = restore
    ? await supabase.rpc('plan_file_restore', { p_source: entry.path, p_destination: destination })
    : await supabase.rpc('plan_file_operation', { p_source: entry.path, p_destination: destination, p_copy: copy });
  if (error) throw new Error(error.message);
  if (data.conflict) return null;
  return preparePlan({ ...data, source: entry.path, destination, copy, restore });
}
// Keep the original immutable plan after partial failures. Retrying skips all
// confirmed steps. An uncertain response stops for review rather than risking
// overwriting a destination that may already have committed.
export async function executeFileOperation(plan: FileOperationPlan, owner: string) {
  // This is preservation of an already deleted item, not a second deletion:
  // retain its bytes, identity and Trash state before freeing the old name.
  if (plan.preserveTrash) await executeFileOperation(plan.preserveTrash, owner);
  const bucket = supabase.storage.from('user-files');
  for (const source of plan.objects) {
    if (plan.done.has(source)) continue;
    const destination = plan.destination + source.slice(plan.source.length);
    const { error } = plan.copy ? await bucket.copy(source, destination) : await bucket.move(source, destination);
    if (error) throw new Error(`${error.message}. Some contents may have completed. Retry skips completed steps; existing destinations are never overwritten.`);
    plan.done.add(source);
  }
  for (const row of plan.metadata) {
    if (plan.metadataDone.has(row.object_path)) continue;
    const path = plan.destination + row.object_path.slice(plan.source.length);
    const trash = { trashed_at: plan.restore ? null : row.trashed_at,
      trash_original_path: plan.restore || plan.copy ? null : row.trash_original_path ?? null };
    // File metadata is already synchronized by the Storage catalog trigger.
    // Folder metadata/sharing must follow after the entire payload is moved.
    if (row.is_folder && !plan.copy) {
      const { error } = await supabase.from('user_file_metadata').update({ object_path: path, ...trash, updated_at: new Date().toISOString() }).eq('owner_id', owner).eq('object_path', row.object_path);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase.from('user_file_metadata').upsert({ owner_id: owner, object_path: path, is_folder: row.is_folder,
        is_favorite: row.is_favorite, file_size: row.file_size, mime_type: row.mime_type, ...trash, updated_at: new Date().toISOString() }, { onConflict: 'owner_id,object_path' });
      if (error) throw new Error(error.message);
    }
    plan.metadataDone.add(row.object_path);
  }
}
export function copyName(name: string, index: number, folder: boolean) {
  const split = !folder && name.lastIndexOf('.') > 0 ? name.lastIndexOf('.') : name.length;
  return `${name.slice(0, split)} (copy${index === 1 ? '' : ` ${index}`})${name.slice(split)}`;
}

import { supabase } from './supabase';
import type { FileEntry, FileMetadata } from './fileTree';
export type FileOperationPlan = { source: string; destination: string; copy: boolean; restore?: boolean; operationId?: string; preserveTrash?: FileOperationPlan; objects: string[]; metadata: FileMetadata[]; done: Set<string>; metadataDone: Set<string> };
type ServerPlan = Omit<FileOperationPlan, 'done' | 'metadataDone' | 'preserveTrash'> & { objectsDone?: string[]; metadataDone?: string[]; preserveTrash?: ServerPlan };
const preparePlan = (plan: ServerPlan): FileOperationPlan => ({ ...plan, done: new Set(plan.objectsDone), metadataDone: new Set(plan.metadataDone), preserveTrash: plan.preserveTrash ? preparePlan({ ...plan.preserveTrash, operationId: plan.operationId, objectsDone: plan.objectsDone, metadataDone: plan.metadataDone }) : undefined });
export async function planFileOperation(entry: FileEntry, destination: string, copy: boolean, restore = false): Promise<FileOperationPlan | null> {
  const { data, error } = await supabase.rpc('begin_file_operation', { p_id: crypto.randomUUID(), p_source: entry.path, p_destination: destination, p_copy: copy, p_restore: restore });
  if (error) throw new Error(error.message);
  if (data.conflict) return null;
  if (typeof data.operationId !== 'string' || !Array.isArray(data.objects)) throw new Error('Transfer recovery is unavailable. Please try again after the server is updated.');
  return preparePlan({ ...data, source: entry.path, destination, copy, restore });
}
export async function unfinishedFileOperations(): Promise<FileOperationPlan[]> {
  const { data, error } = await supabase.rpc('unfinished_file_operations');
  if (error) throw new Error('Could not load unfinished transfers.');
  return (data ?? []).map((plan: ServerPlan) => preparePlan(plan));
}
export async function stopFileOperationTracking(plan: FileOperationPlan) {
  const { error } = await supabase.rpc('stop_file_operation_tracking', { p_id: plan.operationId });
  if (error) throw new Error(error.message);
  window.dispatchEvent(new Event('file-transfer-changed'));
}
async function checkpoint(plan: FileOperationPlan, source: string, metadata: boolean, commit = false): Promise<boolean> {
  if (!plan.operationId) throw new Error('Transfer receipt unavailable.');
  const { data, error } = await supabase.rpc('file_operation_step', { p_id: plan.operationId, p_source: source, p_metadata: metadata, p_commit: commit });
  if (error) throw new Error(error.message);
  return data === true;
}
// Keep the original immutable plan after partial failures. Retrying skips all
// confirmed steps. An uncertain response stops for review rather than risking
// overwriting a destination that may already have committed.
export async function executeFileOperation(plan: FileOperationPlan, owner: string, nested = false) {
  try {
  // This is preservation of an already deleted item, not a second deletion:
  // retain its bytes, identity and Trash state before freeing the old name.
  if (plan.preserveTrash) await executeFileOperation(plan.preserveTrash, owner, true);
  const bucket = supabase.storage.from('user-files');
  for (const source of plan.objects) {
    if (await checkpoint(plan, source, false)) { plan.done.add(source); continue; }
    const destination = plan.destination + source.slice(plan.source.length);
    const { error } = plan.copy ? await bucket.copy(source, destination) : await bucket.move(source, destination);
    if (error) throw new Error(`${error.message}. Some contents may have completed. Retry skips completed steps; existing destinations are never overwritten.`);
    await checkpoint(plan, source, false, true);
    plan.done.add(source);
  }
  for (const row of plan.metadata) {
    if (await checkpoint(plan, row.object_path, true)) { plan.metadataDone.add(row.object_path); continue; }
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
    await checkpoint(plan, row.object_path, true, true);
  }
  if (!nested) {
    const { error } = await supabase.rpc('finish_file_operation', { p_id: plan.operationId });
    if (error) throw new Error(error.message);
  }
  } finally { if (!nested) window.dispatchEvent(new Event('file-transfer-changed')); }
}
export function copyName(name: string, index: number, folder: boolean) {
  const split = !folder && name.lastIndexOf('.') > 0 ? name.lastIndexOf('.') : name.length;
  return `${name.slice(0, split)} (copy${index === 1 ? '' : ` ${index}`})${name.slice(split)}`;
}

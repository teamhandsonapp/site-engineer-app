import { supabase } from '../supabase';
import type { AccountabilityType, DependencyCategory } from './constants';

// The "Global AC/AV Checklist" feature — a real, distinct thing from the
// per-task checklist editing ChecklistItemRow already does. That edits ONE
// task's own dependency_items rows in isolation. This edits the SHARED
// dependency_template_items row (what every NEW task of a matching
// category gets seeded with — see admin-web's DependencyTemplateEditor,
// the same table it edits) AND retroactively cascades that same change
// across every EXISTING task currently classified with the given
// accountabilityType (real user choice: retroactive, not future-only —
// confirmed explicitly before building this, given the blast radius).
//
// Scope is deliberately the task's own EXPLICIT accountability_type (ACC or
// ACV exactly), never unclassified (null) tasks — even for a category like
// "architect" that's visible to both AC and AV tasks, "the AC checklist"
// means tasks someone has actually classified as AC, not every task that
// merely happens to render that category. An unclassified task's own
// checklist is left alone either way until it's classified.
//
// Categories that are exclusive to one type (consultant=AC-only,
// procurement=AV-only) behave exactly as expected. Shared categories
// (architect/client/contractor/quantity) are genuinely shared at the
// TEMPLATE level (there's only one dependency_template_items row per
// category+label, same as admin-web's own single flat template) — editing
// one from the AC view changes what future tasks of BOTH types are seeded
// with, but the retroactive cascade only ever touches the type you're
// actually looking at. Editing the same item from the other type's view
// re-applies the same (already-renamed) template and cascades to that
// other type's existing tasks too — two explicit actions, not one silent
// one, matching how the user described these as two independently
// editable lists.

export interface GlobalTemplateItem {
  id: string;
  category: DependencyCategory;
  label: string;
  sortOrder: number;
}

export async function fetchGlobalTemplateItems(): Promise<GlobalTemplateItem[]> {
  const { data, error } = await supabase
    .from('dependency_template_items')
    .select('id, category, label, sort_order')
    .order('sort_order', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({ id: r.id, category: r.category, label: r.label, sortOrder: r.sort_order }));
}

async function taskIdsForType(accountabilityType: AccountabilityType): Promise<string[]> {
  const { data, error } = await supabase.from('tasks').select('id').eq('accountability_type', accountabilityType);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => r.id);
}

export async function countTasksForType(accountabilityType: AccountabilityType): Promise<number> {
  const { count, error } = await supabase
    .from('tasks')
    .select('id', { count: 'exact', head: true })
    .eq('accountability_type', accountabilityType);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

// Precise pre-check for the delete/edit confirmation dialogs — the exact
// number of real dependency_items rows a bulk edit/delete is about to
// touch, not just "how many tasks of this type exist" (an upper bound that
// could overcount if some of those tasks were already missing this item).
export async function countAffectedItems(
  category: DependencyCategory,
  label: string,
  accountabilityType: AccountabilityType
): Promise<number> {
  const taskIds = await taskIdsForType(accountabilityType);
  if (taskIds.length === 0) return 0;
  const { count, error } = await supabase
    .from('dependency_items')
    .select('id', { count: 'exact', head: true })
    .eq('category', category)
    .eq('item_label', label)
    .in('task_id', taskIds);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export interface BulkResult {
  affectedTaskCount: number;
}

// Adds a new template item, then seeds it onto every existing task of this
// type that doesn't already have an item with this exact category+label
// (idempotent — safe to retry after a partial failure without duplicating
// rows on tasks that already got it).
export async function addGlobalChecklistItem(
  category: DependencyCategory,
  label: string,
  accountabilityType: AccountabilityType
): Promise<{ item: GlobalTemplateItem } & BulkResult> {
  const trimmed = label.trim();
  if (!trimmed) throw new Error('Label is required');

  const { data: existingMax, error: existingErr } = await supabase
    .from('dependency_template_items')
    .select('sort_order')
    .eq('category', category)
    .order('sort_order', { ascending: false })
    .limit(1);
  if (existingErr) throw new Error(existingErr.message);
  const nextSortOrder = (existingMax?.[0]?.sort_order ?? -1) + 1;

  const { data: inserted, error: insertErr } = await supabase
    .from('dependency_template_items')
    // updated_at is Prisma's own @updatedAt (a client-side ORM timestamp, no
    // real Postgres column default) — a direct PostgREST insert must supply
    // it explicitly or the NOT NULL constraint rejects the row (confirmed
    // live: this exact error, same recurring gotcha already fixed on
    // tasks/projects/user_profiles/works inserts elsewhere in this app).
    .insert({ category, label: trimmed, sort_order: nextSortOrder, updated_at: new Date().toISOString() })
    .select('id, category, label, sort_order')
    .single();
  if (insertErr) throw new Error(insertErr.message);

  const taskIds = await taskIdsForType(accountabilityType);
  let toInsertTaskIds = taskIds;
  if (taskIds.length > 0) {
    const { data: already, error: alreadyErr } = await supabase
      .from('dependency_items')
      .select('task_id')
      .eq('category', category)
      .eq('item_label', trimmed)
      .in('task_id', taskIds);
    if (alreadyErr) throw new Error(alreadyErr.message);
    const alreadySet = new Set((already ?? []).map((r) => r.task_id));
    toInsertTaskIds = taskIds.filter((id) => !alreadySet.has(id));
  }

  if (toInsertTaskIds.length > 0) {
    const rows = toInsertTaskIds.map((taskId) => ({ task_id: taskId, category, item_label: trimmed, sort_order: nextSortOrder }));
    const { error: bulkErr } = await supabase.from('dependency_items').insert(rows);
    if (bulkErr) throw new Error(bulkErr.message);
  }

  return {
    item: { id: inserted.id, category: inserted.category, label: inserted.label, sortOrder: inserted.sort_order },
    affectedTaskCount: toInsertTaskIds.length,
  };
}

// Two sequential writes (template, then every matching task's own row) —
// not one atomic transaction, same accepted non-atomicity tradeoff as
// updateItemStatus elsewhere in this file's sibling (data.ts): a failure
// between the two would leave the template renamed but some existing
// tasks not yet caught up, recoverable by simply re-running the edit.
export async function editGlobalChecklistItem(
  templateItemId: string,
  category: DependencyCategory,
  oldLabel: string,
  newLabel: string,
  accountabilityType: AccountabilityType
): Promise<BulkResult> {
  const trimmed = newLabel.trim();
  if (!trimmed) throw new Error('Label is required');

  const { error: updateErr } = await supabase
    .from('dependency_template_items')
    .update({ label: trimmed, updated_at: new Date().toISOString() })
    .eq('id', templateItemId);
  if (updateErr) throw new Error(updateErr.message);
  if (trimmed === oldLabel) return { affectedTaskCount: 0 };

  const taskIds = await taskIdsForType(accountabilityType);
  if (taskIds.length === 0) return { affectedTaskCount: 0 };

  const { data: matching, error: matchErr } = await supabase
    .from('dependency_items')
    .update({ item_label: trimmed })
    .eq('category', category)
    .eq('item_label', oldLabel)
    .in('task_id', taskIds)
    .select('id');
  if (matchErr) throw new Error(matchErr.message);

  return { affectedTaskCount: matching?.length ?? 0 };
}

// Deleting the template row does NOT cascade to existing dependency_items
// rows at the DB level (they're independent rows, only sharing a
// category+label convention, not a real FK) — the bulk delete below is
// what actually removes them from every matching task; each removed row's
// own comments/completion/status-history/drawing-revisions cascade via
// their existing onDelete: Cascade FKs, same as a single-item delete.
export async function deleteGlobalChecklistItem(
  templateItemId: string,
  category: DependencyCategory,
  label: string,
  accountabilityType: AccountabilityType
): Promise<BulkResult> {
  const { error: deleteErr } = await supabase.from('dependency_template_items').delete().eq('id', templateItemId);
  if (deleteErr) throw new Error(deleteErr.message);

  const taskIds = await taskIdsForType(accountabilityType);
  if (taskIds.length === 0) return { affectedTaskCount: 0 };

  const { data: matching, error: matchErr } = await supabase
    .from('dependency_items')
    .delete()
    .eq('category', category)
    .eq('item_label', label)
    .in('task_id', taskIds)
    .select('id');
  if (matchErr) throw new Error(matchErr.message);

  return { affectedTaskCount: matching?.length ?? 0 };
}

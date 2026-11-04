#!/usr/bin/env node
// Seeds demo DPR entries for a client presentation, so Task / Weekly /
// Monthly / Custom / Site Engineer Status all have data to show.
//
//   $env:SUPABASE_SERVICE_ROLE_KEY="sb_secret_..."; node scripts/seed-demo-dprs.mjs
//   $env:SUPABASE_SERVICE_ROLE_KEY="sb_secret_..."; node scripts/seed-demo-dprs.mjs --cleanup
//
// Only INSERTS new (task, day) rows — never overwrites a real DPR that already
// exists for that task+day. Every inserted id is written to
// scripts/.seed-demo-dprs.json; --cleanup deletes exactly those ids.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const PROJECT_NAME_LIKE = '%ROAST%';
const ENTRY_COUNT = 20;
const FROM_DATE = '2026-09-25';
const TO_DATE = '2026-10-22';

const here = path.dirname(fileURLToPath(import.meta.url));
const ledgerPath = path.join(here, '.seed-demo-dprs.json');
const envLocal = fs.readFileSync(path.join(here, '../.env.local'), 'utf8');
const URL = envLocal.match(/^EXPO_PUBLIC_SUPABASE_URL=(.+)$/m)?.[1].trim();
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error('Set SUPABASE_SERVICE_ROLE_KEY (and EXPO_PUBLIC_SUPABASE_URL in .env.local).');
  process.exit(1);
}
const db = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

if (process.argv.includes('--cleanup')) {
  if (!fs.existsSync(ledgerPath)) {
    console.log('Nothing to clean up — no ledger file.');
    process.exit(0);
  }
  const ids = JSON.parse(fs.readFileSync(ledgerPath, 'utf8')).ids;
  const { error } = await db.from('dpr_entries').delete().in('id', ids);
  if (error) throw new Error(error.message);
  fs.unlinkSync(ledgerPath);
  console.log(`Deleted ${ids.length} demo DPR entries.`);
  process.exit(0);
}

const { data: projects, error: projErr } = await db.from('projects').select('id, name').ilike('name', PROJECT_NAME_LIKE);
if (projErr) throw new Error(projErr.message);
if (!projects?.length) throw new Error(`No project matching ${PROJECT_NAME_LIKE}`);
const project = projects[0];
console.log(`Project: ${project.name} (${project.id})`);

const { data: tasks, error: taskErr } = await db
  .from('tasks')
  .select('id, task_id, task_name, assigned_to, work:works!inner(name, project_id)')
  .eq('work.project_id', project.id)
  .is('deleted_at', null)
  .order('task_id')
  .limit(200);
if (taskErr) throw new Error(taskErr.message);
if (!tasks?.length) throw new Error('Project has no tasks — create some in the flowchart first.');

const { data: members } = await db.from('project_users').select('user_id').eq('project_id', project.id);
const { data: engineers } = await db
  .from('user_profiles')
  .select('id, full_name, role')
  .in('role', ['site_engineer', 'senior_site_engineer'])
  .in('id', (members ?? []).map((m) => m.user_id));
if (!engineers?.length) throw new Error('No site engineers are assigned to this project — add one first.');
const engineerIds = new Set(engineers.map((e) => e.id));
console.log(`Tasks: ${tasks.length}, site engineers: ${engineers.map((e) => e.full_name).join(', ')}`);

// 5 tasks x 4 days each = 20 entries; prefer tasks already assigned to an engineer.
const picked = [...tasks].sort((a, b) => Number(engineerIds.has(b.assigned_to)) - Number(engineerIds.has(a.assigned_to))).slice(0, 5);

const days = [];
for (let d = new Date(`${FROM_DATE}T00:00:00Z`); d <= new Date(`${TO_DATE}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
  if (d.getUTCDay() !== 0) days.push(d.toISOString().slice(0, 10)); // skip Sundays
}

const COMMENTS = ['awaiting_material_delivery', 'labour_shortage', 'awaiting_client_approval', 'weather_delay', 'coordination_pending', 'awaiting_inspection_signoff'];
const DEPENDENCIES = [[], [], ['vendor'], ['client'], ['contractor'], ['architect'], []];
const rand = (n) => Math.floor(Math.random() * n);

const { data: existing } = await db
  .from('dpr_entries')
  .select('task_id, report_date')
  .in('task_id', picked.map((t) => t.id))
  .gte('report_date', FROM_DATE)
  .lte('report_date', TO_DATE);
const taken = new Set((existing ?? []).map((e) => `${e.task_id}|${e.report_date}`));

const rows = [];
const perTask = Math.ceil(ENTRY_COUNT / picked.length);
picked.forEach((task, ti) => {
  const engineer = engineerIds.has(task.assigned_to) ? task.assigned_to : engineers[ti % engineers.length].id;
  // Spread each task's days evenly across the whole window, offset per task.
  const step = Math.floor(days.length / perTask);
  let percent = 5 + rand(15);
  for (let i = 0; i < perTask && rows.length < ENTRY_COUNT; i++) {
    const date = days[Math.min(days.length - 1, i * step + (ti % step))];
    if (taken.has(`${task.id}|${date}`)) continue;
    percent = Math.min(100, percent + 10 + rand(15));
    const hasComment = Math.random() < 0.4;
    const targeted = 8 + rand(8);
    rows.push({
      task_id: task.id,
      report_date: date,
      dependency_categories: DEPENDENCIES[rand(DEPENDENCIES.length)],
      dependency_other_text: null,
      comment_preset: hasComment ? COMMENTS[rand(COMMENTS.length)] : null,
      comment_text: null,
      percent_complete: percent,
      targeted_workforce_per_day: targeted,
      actual_workforce_per_day: Math.max(1, targeted - 3 + rand(5)),
      submitted_by: engineer,
      submitted_at: `${date}T12:30:00Z`,
      architect_comment: null,
      client_comment: null,
    });
  }
});

const { data: inserted, error: insErr } = await db.from('dpr_entries').insert(rows).select('id, report_date');
if (insErr) throw new Error(insErr.message);
const prior = fs.existsSync(ledgerPath) ? JSON.parse(fs.readFileSync(ledgerPath, 'utf8')).ids : [];
fs.writeFileSync(ledgerPath, JSON.stringify({ ids: [...prior, ...inserted.map((r) => r.id)] }, null, 2));

console.log(`Inserted ${inserted.length} demo DPR entries for:`);
for (const t of picked) console.log(`  ${t.task_id}  ${t.task_name}  (${t.work.name})`);
const dates = inserted.map((r) => r.report_date).sort();
console.log(`Dates: ${dates[0]} → ${dates[dates.length - 1]}`);
console.log('Undo later with: node scripts/seed-demo-dprs.mjs --cleanup');

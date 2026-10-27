import { supabase } from './supabase';
import type { ContactCategory } from './contacts';

// "Specific Book" — project-scoped contacts, visible to whoever is a
// project_users member of that project (site engineers included), distinct
// from the admin-only global address book (lib/contacts.ts, "Contact
// Book"). Reuses the same ContactCategory vocabulary for consistency.
export interface ProjectContact {
  id: string;
  projectId: string;
  name: string;
  phoneNumber: string;
  altPhoneNumber: string | null;
  email: string | null;
  companyName: string | null;
  category: ContactCategory;
  notes: string | null;
  createdAtISO: string;
}

export interface ProjectContactFields {
  name: string;
  phoneNumber: string;
  altPhoneNumber: string | null;
  email: string | null;
  companyName: string | null;
  category: ContactCategory;
  notes: string | null;
}

interface RawProjectContact {
  id: string;
  project_id: string;
  name: string;
  phone_number: string;
  alt_phone_number: string | null;
  email: string | null;
  company_name: string | null;
  category: ContactCategory;
  notes: string | null;
  created_at: string;
}

function toProjectContact(row: RawProjectContact): ProjectContact {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    phoneNumber: row.phone_number,
    altPhoneNumber: row.alt_phone_number,
    email: row.email,
    companyName: row.company_name,
    category: row.category,
    notes: row.notes,
    createdAtISO: row.created_at,
  };
}

const PROJECT_CONTACT_SELECT = 'id, project_id, name, phone_number, alt_phone_number, email, company_name, category, notes, created_at';

export async function fetchProjectContacts(projectId: string): Promise<ProjectContact[]> {
  const { data, error } = await supabase
    .from('project_contacts')
    .select(PROJECT_CONTACT_SELECT)
    .eq('project_id', projectId)
    .order('name', { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as RawProjectContact[]).map(toProjectContact);
}

export async function createProjectContact(projectId: string, fields: ProjectContactFields, createdBy: string | null): Promise<void> {
  const { error } = await supabase.from('project_contacts').insert({
    project_id: projectId,
    name: fields.name,
    phone_number: fields.phoneNumber,
    alt_phone_number: fields.altPhoneNumber,
    email: fields.email,
    company_name: fields.companyName,
    category: fields.category,
    notes: fields.notes,
    created_by: createdBy,
  });
  if (error) throw new Error(error.message);
}

export async function updateProjectContact(id: string, fields: ProjectContactFields): Promise<void> {
  const { error } = await supabase
    .from('project_contacts')
    .update({
      name: fields.name,
      phone_number: fields.phoneNumber,
      alt_phone_number: fields.altPhoneNumber,
      email: fields.email,
      company_name: fields.companyName,
      category: fields.category,
      notes: fields.notes,
    })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteProjectContact(id: string): Promise<void> {
  const { error } = await supabase.from('project_contacts').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

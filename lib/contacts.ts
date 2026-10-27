import { supabase } from './supabase';

// Admin's own address book — manually entered contractors/vendors/clients/
// architects/consultants (and anything else, under 'other'), NOT pulled
// from user_profiles/tasks. Most of these people/companies never have an
// app login at all, so there's no "real" row anywhere else to read this
// from. category reuses the same vocabulary DPR/checklists already use
// (see lib/dprEntries.ts's DPR_DEPENDENCY_CATEGORIES) for consistency,
// plus 'other'.
export type ContactCategory = 'architect' | 'client' | 'consultant' | 'contractor' | 'vendor' | 'other';

export const CONTACT_CATEGORIES: ContactCategory[] = ['contractor', 'vendor', 'client', 'architect', 'consultant', 'other'];

export const CONTACT_CATEGORY_LABEL: Record<ContactCategory, string> = {
  architect: 'Architect',
  client: 'Client',
  consultant: 'Consultant',
  contractor: 'Contractor',
  vendor: 'Vendor',
  other: 'Other',
};

export interface Contact {
  id: string;
  name: string;
  phoneNumber: string;
  altPhoneNumber: string | null;
  teamMemberNumber: string | null;
  email: string | null;
  locationLink: string | null;
  companyName: string | null;
  category: ContactCategory;
  notes: string | null;
  createdAtISO: string;
}

export interface ContactFields {
  name: string;
  phoneNumber: string;
  altPhoneNumber: string | null;
  teamMemberNumber: string | null;
  email: string | null;
  locationLink: string | null;
  companyName: string | null;
  category: ContactCategory;
  notes: string | null;
}

interface RawContact {
  id: string;
  name: string;
  phone_number: string;
  alt_phone_number: string | null;
  team_member_number: string | null;
  email: string | null;
  location_link: string | null;
  company_name: string | null;
  category: ContactCategory;
  notes: string | null;
  created_at: string;
}

function toContact(row: RawContact): Contact {
  return {
    id: row.id,
    name: row.name,
    phoneNumber: row.phone_number,
    altPhoneNumber: row.alt_phone_number,
    teamMemberNumber: row.team_member_number,
    email: row.email,
    locationLink: row.location_link,
    companyName: row.company_name,
    category: row.category,
    notes: row.notes,
    createdAtISO: row.created_at,
  };
}

const CONTACT_SELECT =
  'id, name, phone_number, alt_phone_number, team_member_number, email, location_link, company_name, category, notes, created_at';

export async function fetchContacts(): Promise<Contact[]> {
  const { data, error } = await supabase.from('contacts').select(CONTACT_SELECT).order('name', { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as RawContact[]).map(toContact);
}

export async function createContact(fields: ContactFields, createdBy: string | null): Promise<void> {
  const { error } = await supabase.from('contacts').insert({
    name: fields.name,
    phone_number: fields.phoneNumber,
    alt_phone_number: fields.altPhoneNumber,
    team_member_number: fields.teamMemberNumber,
    email: fields.email,
    location_link: fields.locationLink,
    company_name: fields.companyName,
    category: fields.category,
    notes: fields.notes,
    created_by: createdBy,
  });
  if (error) throw new Error(error.message);
}

export async function updateContact(id: string, fields: ContactFields): Promise<void> {
  const { error } = await supabase
    .from('contacts')
    .update({
      name: fields.name,
      phone_number: fields.phoneNumber,
      alt_phone_number: fields.altPhoneNumber,
      team_member_number: fields.teamMemberNumber,
      email: fields.email,
      location_link: fields.locationLink,
      company_name: fields.companyName,
      category: fields.category,
      notes: fields.notes,
    })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteContact(id: string): Promise<void> {
  const { error } = await supabase.from('contacts').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// "Name: Suresh Reddy\nRole: Contractor\nPhone: +91-98765-00001\nCompany:
// Reddy Constructions" — shared by both Copy and the WhatsApp share text,
// so the two can never drift into different wording for the same contact.
export function formatContactCard(contact: Contact): string {
  const lines = [`Name: ${contact.name}`, `Role: ${CONTACT_CATEGORY_LABEL[contact.category]}`, `Phone: ${contact.phoneNumber}`];
  if (contact.altPhoneNumber) lines.push(`Alternative Number: ${contact.altPhoneNumber}`);
  if (contact.teamMemberNumber) lines.push(`Team Member Number: ${contact.teamMemberNumber}`);
  if (contact.email) lines.push(`Email: ${contact.email}`);
  if (contact.companyName) lines.push(`Company: ${contact.companyName}`);
  if (contact.locationLink) lines.push(`Location: ${contact.locationLink}`);
  if (contact.notes) lines.push(`Notes: ${contact.notes}`);
  return lines.join('\n');
}

// wa.me with no target number opens WhatsApp's own chat picker prefilled
// with this text — sharing the contact card to whoever the admin picks,
// not messaging the contact directly (this app has no way to know the
// contact's own WhatsApp-registered number is even reachable).
export function whatsappShareUrl(contact: Contact): string {
  return `https://wa.me/?text=${encodeURIComponent(formatContactCard(contact))}`;
}

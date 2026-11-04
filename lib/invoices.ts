import { supabase } from './supabase';

export type InvoiceStatus = 'draft' | 'sent';

export interface Invoice {
  id: string;
  invoiceNumber: number;
  projectId: string;
  projectName: string;
  clientUserProfileId: string;
  issueDate: string; // 'YYYY-MM-DD'
  description: string;
  amount: number;
  status: InvoiceStatus;
  sentAt: string | null;
  createdAt: string;
}

interface RawInvoiceRow {
  id: string;
  invoice_number: number;
  project_id: string;
  client_user_profile_id: string;
  issue_date: string;
  description: string;
  amount: string;
  status: InvoiceStatus;
  sent_at: string | null;
  created_at: string;
  project: { name: string } | null;
}

// Reads directly via Supabase (RLS: staff sees every invoice, a client only
// their own `sent` ones — see supabase/rls-policies.sql). Only the WRITES
// (create, send) go through the send-invoice Edge Function — see that
// function's own header for why creating/sending needs a server-side
// permission check a plain RLS policy can't express per-role.
//
// Deliberately does NOT embed the client's name via
// user_profiles(full_name) here — user_profiles' own RLS only allows
// reading YOUR OWN row (see rls-policies.sql's "own profile readable"), so
// that embed would silently come back null for every invoice when a STAFF
// user (viewing invoices that aren't their own) calls this, not just for a
// client. Callers that need the client's display name should resolve
// clientUserProfileId against the user list already fetched via
// lib/accessRoles.ts's fetchAllUsers() (which the Invoice screen needs
// anyway, to populate the client picker), not a second, broken join here.
export async function fetchInvoices(projectId?: string): Promise<Invoice[]> {
  let query = supabase
    .from('invoices')
    .select(`
      id, invoice_number, project_id, client_user_profile_id, issue_date, description, amount, status, sent_at, created_at,
      project:projects(name)
    `)
    .order('created_at', { ascending: false });
  if (projectId) query = query.eq('project_id', projectId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return ((data ?? []) as unknown as RawInvoiceRow[]).map((r) => ({
    id: r.id,
    invoiceNumber: r.invoice_number,
    projectId: r.project_id,
    projectName: r.project?.name ?? 'Unknown project',
    clientUserProfileId: r.client_user_profile_id,
    issueDate: r.issue_date,
    description: r.description,
    amount: Number(r.amount),
    status: r.status,
    sentAt: r.sent_at,
    createdAt: r.created_at,
  }));
}

async function invokeSendInvoice<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('send-invoice', { body });
  if (error) throw new Error(error.message);
  if (!data?.ok) throw new Error(data?.message ?? 'Request failed');
  return data as T;
}

export async function createInvoice(input: {
  projectId: string;
  clientUserProfileId: string;
  issueDate: string;
  description: string;
  amount: number;
}): Promise<{ invoiceId: string; invoiceNumber: number }> {
  return invokeSendInvoice({ type: 'create', ...input });
}

export async function sendInvoice(invoiceId: string): Promise<void> {
  await invokeSendInvoice({ type: 'send', invoiceId });
}

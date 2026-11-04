import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../lib/AuthContext';
import { fetchAllUsers, type ManagedUser } from '../../lib/accessRoles';
import { fetchStaffProjects, type ProjectOption } from '../../lib/projects';
import { createInvoice, fetchInvoices, sendInvoice, type Invoice } from '../../lib/invoices';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { DateField } from '../../components/ui/DateField';

function formatDate(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatAmount(amount: number): string {
  return `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function todayDateKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function InvoiceRow({ invoice, clientName, onPress }: { invoice: Invoice; clientName: string; onPress: () => void }) {
  const sent = invoice.status === 'sent';
  return (
    <Pressable onPress={onPress}>
      <Card accentColor={sent ? '#16A34A' : '#9CA3AF'} className="mb-2.5">
        <View className="flex-row items-start justify-between gap-2">
          <Text className="text-sm font-semibold text-neutral-900 flex-1" numberOfLines={1}>
            Invoice #{invoice.invoiceNumber}
          </Text>
          <View className="px-2 py-0.5 rounded-full flex-shrink-0" style={{ backgroundColor: sent ? '#DCFCE7' : '#F3F4F6' }}>
            <Text className="text-2xs font-semibold" style={{ color: sent ? '#15803D' : '#6B7280' }}>
              {sent ? 'Sent' : 'Draft'}
            </Text>
          </View>
        </View>
        <Text className="text-xs text-neutral-500 mt-0.5">{clientName} · {invoice.projectName}</Text>
        <View className="flex-row items-center justify-between mt-1.5">
          <Text className="text-xs text-neutral-400">{formatDate(invoice.issueDate)}</Text>
          <Text className="text-sm font-bold text-neutral-900">{formatAmount(invoice.amount)}</Text>
        </View>
      </Card>
    </Pressable>
  );
}

// A clean, basic invoice preview — company name, invoice number, date,
// client, amount, one description line — per the brief's own "doesn't need
// to be elaborate, just professional and legible" instruction, not a full
// accounting-system layout.
function InvoicePreview({
  invoice,
  clientName,
  onClose,
  onSend,
  sending,
  sendError,
}: {
  invoice: Invoice;
  clientName: string;
  onClose: () => void;
  onSend: () => void;
  sending: boolean;
  sendError: string | null;
}) {
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/40 items-center justify-center px-6" onPress={onClose}>
        <Pressable onPress={() => {}} style={{ width: '100%', maxWidth: 380 }}>
          <Card>
            <View className="items-center border-b border-neutral-100 pb-3 mb-3">
              <Text className="text-lg font-bold text-neutral-900">PMC Portal</Text>
              <Text className="text-xs text-neutral-400 mt-0.5">Invoice</Text>
            </View>

            <View className="flex-row justify-between mb-3">
              <View>
                <Text className="text-2xs uppercase tracking-wide text-neutral-400">Invoice No.</Text>
                <Text className="text-sm font-semibold text-neutral-900">#{invoice.invoiceNumber}</Text>
              </View>
              <View className="items-end">
                <Text className="text-2xs uppercase tracking-wide text-neutral-400">Issue Date</Text>
                <Text className="text-sm font-semibold text-neutral-900">{formatDate(invoice.issueDate)}</Text>
              </View>
            </View>

            <View className="mb-3">
              <Text className="text-2xs uppercase tracking-wide text-neutral-400">Billed To</Text>
              <Text className="text-sm font-semibold text-neutral-900">{clientName}</Text>
              <Text className="text-xs text-neutral-500">{invoice.projectName}</Text>
            </View>

            <View className="rounded-lg bg-neutral-50 px-3 py-2.5 mb-3">
              <Text className="text-sm text-neutral-700">{invoice.description}</Text>
            </View>

            <View className="flex-row justify-between items-center border-t border-neutral-100 pt-3 mb-3">
              <Text className="text-sm font-semibold text-neutral-500">Total</Text>
              <Text className="text-lg font-bold text-neutral-900">{formatAmount(invoice.amount)}</Text>
            </View>

            {sendError && (
              <View className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 mb-2">
                <Text className="text-xs text-red-600">{sendError}</Text>
              </View>
            )}

            <View className="flex-row justify-end gap-2">
              <Pressable onPress={onClose} className="px-3 py-1.5 rounded-lg bg-neutral-100">
                <Text className="text-xs font-semibold text-neutral-600">Close</Text>
              </Pressable>
              {invoice.status === 'draft' && (
                <Pressable onPress={onSend} disabled={sending} className="px-3 py-1.5 rounded-lg bg-brand-navy flex-row items-center gap-1.5">
                  {sending && <ActivityIndicator size="small" color="#fff" />}
                  <Text className="text-xs font-semibold text-white">Send to Client</Text>
                </Pressable>
              )}
            </View>
          </Card>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function CreateInvoiceSheet({
  visible,
  projects,
  clients,
  onClose,
  onCreated,
}: {
  visible: boolean;
  projects: ProjectOption[];
  clients: ManagedUser[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [issueDate, setIssueDate] = useState(todayDateKey());
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const projectClients = useMemo(
    () => (projectId ? clients.filter((c) => c.clientProjectId === projectId) : []),
    [clients, projectId]
  );

  function reset() {
    setProjectId(null);
    setClientId(null);
    setIssueDate(todayDateKey());
    setDescription('');
    setAmount('');
    setError(null);
  }

  async function submit() {
    const numericAmount = Number(amount);
    if (!projectId || !clientId || !issueDate.trim() || !description.trim() || !numericAmount || numericAmount <= 0) {
      setError('Project, client, issue date, description, and a positive amount are all required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await createInvoice({ projectId, clientUserProfileId: clientId, issueDate: issueDate.trim(), description: description.trim(), amount: numericAmount });
      reset();
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the invoice');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => { reset(); onClose(); }}>
      <Pressable className="flex-1 bg-black/40 items-center justify-center px-6" onPress={() => { reset(); onClose(); }}>
        <Pressable onPress={() => {}} style={{ width: '100%', maxWidth: 380, maxHeight: '85%' }}>
          <Card>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text className="text-md font-bold text-neutral-900 mb-3">Create Invoice</Text>
              {error && (
                <View className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 mb-2">
                  <Text className="text-xs text-red-600">{error}</Text>
                </View>
              )}

              <Text className="text-xs text-neutral-400 mb-1.5">Project</Text>
              <View className="gap-1.5 mb-3">
                {projects.map((p) => {
                  const active = p.id === projectId;
                  return (
                    <Pressable
                      key={p.id}
                      onPress={() => { setProjectId(p.id); setClientId(null); }}
                      className={`px-3 py-2 rounded-lg ${active ? 'bg-brand-navy' : 'bg-neutral-50'}`}
                    >
                      <Text className={`text-sm font-medium ${active ? 'text-white' : 'text-neutral-700'}`}>{p.name}</Text>
                    </Pressable>
                  );
                })}
              </View>

              {projectId && (
                <View className="mb-3">
                  <Text className="text-xs text-neutral-400 mb-1.5">Client</Text>
                  {projectClients.length === 0 ? (
                    <Text className="text-xs text-neutral-400 italic">No client account is linked to this project yet.</Text>
                  ) : (
                    <View className="gap-1.5">
                      {projectClients.map((c) => {
                        const active = c.id === clientId;
                        return (
                          <Pressable
                            key={c.id}
                            onPress={() => setClientId(c.id)}
                            className={`px-3 py-2 rounded-lg ${active ? 'bg-brand-navy' : 'bg-neutral-50'}`}
                          >
                            <Text className={`text-sm font-medium ${active ? 'text-white' : 'text-neutral-700'}`}>{c.fullName}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  )}
                </View>
              )}

              <View className="mb-3">
                <DateField label="Issue Date" value={issueDate} onChange={setIssueDate} />
              </View>

              <Text className="text-xs text-neutral-400 mb-1">Description</Text>
              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder="e.g. Civil works — July progress billing"
                multiline
                numberOfLines={2}
                className="border border-neutral-200 rounded-lg px-3 py-2 text-sm text-neutral-900 mb-3"
                style={{ minHeight: 52, textAlignVertical: 'top' }}
              />

              <Text className="text-xs text-neutral-400 mb-1">Amount (₹)</Text>
              <TextInput
                value={amount}
                onChangeText={setAmount}
                keyboardType="decimal-pad"
                placeholder="0.00"
                className="border border-neutral-200 rounded-lg px-3 py-2 text-sm text-neutral-900 mb-3"
              />

              <View className="flex-row justify-end gap-2">
                <Pressable onPress={() => { reset(); onClose(); }} className="px-3 py-1.5 rounded-lg bg-neutral-100">
                  <Text className="text-xs font-semibold text-neutral-600">Cancel</Text>
                </Pressable>
                <Pressable onPress={submit} disabled={saving} className="px-3 py-1.5 rounded-lg bg-brand-navy flex-row items-center gap-1.5">
                  {saving && <ActivityIndicator size="small" color="#fff" />}
                  <Text className="text-xs font-semibold text-white">Create</Text>
                </Pressable>
              </View>
            </ScrollView>
          </Card>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// New Invoice module (Part 4) — a genuinely minimal billing model (one
// description line + a total amount, no line-item table) per the brief's
// own "keep it simple" instruction. Creating and sending both go through
// the send-invoice Edge Function (server-side permission check — see that
// function's header), while listing reads directly via Supabase (RLS
// already scopes a client to only their own `sent` invoices). Sending
// triggers the existing push-notification pipeline via a Postgres trigger
// (supabase/invoice-notifications.sql), not a new mechanism.
export default function InvoicesScreen() {
  const { state } = useAuth();
  const profile = state.status === 'signed-in' ? state.profile : null;
  const isAdminOrManager = profile != null && (profile.role === 'admin' || profile.role === 'manager');
  const isClient = profile != null && profile.role === 'client';

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [clients, setClients] = useState<ManagedUser[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewInvoice, setPreviewInvoice] = useState<Invoice | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      if (isAdminOrManager) {
        const [inv, cl, pr] = await Promise.all([fetchInvoices(), fetchAllUsers(), fetchStaffProjects()]);
        setInvoices(inv);
        setClients(cl.filter((u) => u.role === 'client'));
        setProjects(pr);
      } else {
        // A client's own RLS scope already limits this to their own sent
        // invoices — no separate client-only fetch path needed.
        setInvoices(await fetchInvoices());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [isAdminOrManager]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const clientNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of clients) map.set(c.id, c.fullName);
    if (profile) map.set(profile.id, profile.fullName);
    return map;
  }, [clients, profile]);

  async function handleSend() {
    if (!previewInvoice) return;
    setSending(true);
    setSendError(null);
    try {
      await sendInvoice(previewInvoice.id);
      setInvoices((prev) => prev.map((i) => (i.id === previewInvoice.id ? { ...i, status: 'sent', sentAt: new Date().toISOString() } : i)));
      setPreviewInvoice(null);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Could not send this invoice');
    } finally {
      setSending(false);
    }
  }

  if (!isAdminOrManager && !isClient) {
    return (
      <View className="flex-1 bg-neutral-50 items-center justify-center px-8">
        <Text className="text-md font-semibold text-neutral-800 text-center">Not available for this account</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-neutral-50">
      <View className="px-5 pt-4 pb-3 bg-white border-b border-neutral-100 flex-row items-center justify-between">
        <View className="flex-1 pr-2">
          <Text className="text-lg font-bold text-neutral-900">Invoices</Text>
          <Text className="text-xs text-neutral-400 mt-0.5">
            {invoices.length} invoice{invoices.length === 1 ? '' : 's'}
          </Text>
        </View>
        {isAdminOrManager && (
          <Pressable onPress={() => setCreateOpen(true)} className="w-9 h-9 rounded-full bg-brand-navy items-center justify-center">
            <Ionicons name="add" size={20} color="#fff" />
          </Pressable>
        )}
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#0F1F33" />
        </View>
      ) : error ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-sm text-red-600 text-center mb-3">Couldn&apos;t load invoices: {error}</Text>
          <Pressable
            onPress={() => { setLoading(true); load().finally(() => setLoading(false)); }}
            className="px-4 py-2 rounded-lg bg-white border border-red-200"
          >
            <Text className="text-xs font-semibold text-red-600">Retry</Text>
          </Pressable>
        </View>
      ) : (
        // FlatList, not a ScrollView + .map() — invoices accumulate every
        // month with no query limit (fetchInvoices() is unbounded by
        // design, so real invoices are never silently truncated), so this
        // list should only ever render the rows actually on screen rather
        // than the whole history at once.
        <FlatList
          data={invoices}
          keyExtractor={(inv) => inv.id}
          contentContainerClassName="px-4 pt-4 pb-8 flex-grow"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#0F1F33" />}
          ListEmptyComponent={
            <EmptyState icon="receipt-outline" iconColor="#9CA3AF" title="No invoices yet" subtitle={isAdminOrManager ? 'Create the first one with the + button above.' : 'You have no invoices yet.'} />
          }
          renderItem={({ item }) => (
            <InvoiceRow
              invoice={item}
              clientName={clientNameById.get(item.clientUserProfileId) ?? 'Client'}
              onPress={() => setPreviewInvoice(item)}
            />
          )}
        />
      )}

      {previewInvoice && (
        <InvoicePreview
          invoice={previewInvoice}
          clientName={clientNameById.get(previewInvoice.clientUserProfileId) ?? 'Client'}
          onClose={() => { setPreviewInvoice(null); setSendError(null); }}
          onSend={handleSend}
          sending={sending}
          sendError={sendError}
        />
      )}

      {isAdminOrManager && (
        <CreateInvoiceSheet
          visible={createOpen}
          projects={projects}
          clients={clients}
          onClose={() => setCreateOpen(false)}
          onCreated={load}
        />
      )}
    </View>
  );
}

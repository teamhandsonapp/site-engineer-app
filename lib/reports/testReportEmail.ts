// TEST progress-report emails (sample data). Thin client for the
// send-test-report Edge Function (admin-web repo, feature/email-reports):
// the function checks the caller is an admin, rate-limits (10/hour),
// builds the PDF + email and sends it through Resend. Nothing here holds a
// key — the user's own session token is what the function checks.

import { Platform } from 'react-native';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '../supabase';

export type TestReportType = 'weekly' | 'monthly';

export async function sendTestReport(type: TestReportType, to: string): Promise<{ ok: true; resendId: string } | { ok: false; error: string }> {
  const { data, error } = await supabase.functions.invoke('send-test-report', { body: { type, to: to.trim() } });
  if (!error) {
    const d = data as { ok?: boolean; resend_id?: string; error?: string };
    return d?.ok && d.resend_id ? { ok: true, resendId: d.resend_id } : { ok: false, error: d?.error ?? 'Email could not be sent.' };
  }
  if (error instanceof FunctionsHttpError) {
    const body = (await (error.context as Response).json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: body.error ?? 'Email could not be sent.' };
  }
  return { ok: false, error: 'No connection — try again.' };
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// Downloads the sample PDF (no email is sent) and opens the share sheet /
// browser download so it can be checked before sending.
export async function previewTestReportPdf(type: TestReportType): Promise<void> {
  const { data: s } = await supabase.auth.getSession();
  const token = s.session?.access_token;
  if (!token) throw new Error('Sign in again.');
  const res = await fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/send-test-report`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '', 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, preview: true }),
  });
  if (!res.ok || !res.headers.get('content-type')?.includes('application/pdf')) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? 'Preview failed.');
  }
  const fileName = `${type}-report-sample-${new Date().toISOString().slice(0, 10)}.pdf`;

  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return;
  }
  const uri = `${FileSystem.cacheDirectory}${fileName}`;
  await FileSystem.writeAsStringAsync(uri, toBase64(await res.arrayBuffer()), { encoding: FileSystem.EncodingType.Base64 });
  if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing isn't available on this device.");
  await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Sample report', UTI: 'com.adobe.pdf' });
}

export interface TestReportLogRow {
  id: string;
  created_at: string;
  type: TestReportType;
  recipient: string;
  status: 'sent' | 'failed';
  error: string | null;
}

// Last 20 attempts (RLS: admins only).
export async function fetchRecentTestReports(): Promise<TestReportLogRow[]> {
  const { data, error } = await supabase
    .from('report_email_log')
    .select('id, created_at, type, recipient, status, error')
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);
  return (data ?? []) as TestReportLogRow[];
}

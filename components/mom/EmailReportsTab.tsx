// MoM › Email Reports (TEST): send a sample weekly / monthly progress report
// (dummy data, PDF attached) to any address, preview the PDF, and see the
// last 20 sends. Admin only — the backend function enforces it too.

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { Card } from '../ui/Card';
import { Banner, Button, Field, NAVY, SectionTitle } from './ui';
import { fetchRecentTestReports, previewTestReportPdf, sendTestReport, type TestReportLogRow, type TestReportType } from '../../lib/reports/testReportEmail';

const fmt = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(new Date(iso));

export function EmailReportsTab({ defaultEmail }: { defaultEmail: string }) {
  const [to, setTo] = useState(defaultEmail);
  const [busy, setBusy] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [rows, setRows] = useState<TestReportLogRow[] | null>(null);
  const [logError, setLogError] = useState<string | null>(null);

  const loadLog = useCallback(async () => {
    try {
      setRows(await fetchRecentTestReports());
      setLogError(null);
    } catch (e) {
      setLogError(e instanceof Error ? e.message : 'Could not load the send log');
    }
  }, []);

  useEffect(() => {
    let live = true;
    fetchRecentTestReports()
      .then((r) => live && setRows(r))
      .catch((e) => live && setLogError(e instanceof Error ? e.message : 'Could not load the send log'));
    return () => {
      live = false;
    };
  }, []);

  async function send(type: TestReportType) {
    setBusy(`send-${type}`);
    setBanner(null);
    const r = await sendTestReport(type, to);
    setBusy(null);
    setBanner(r.ok ? { tone: 'ok', text: `Test ${type} report sent to ${to.trim()}. Check the inbox (and Spam) in a minute.` } : { tone: 'error', text: r.error });
    void loadLog();
  }

  async function preview(type: TestReportType) {
    setBusy(`preview-${type}`);
    setBanner(null);
    try {
      await previewTestReportPdf(type);
    } catch (e) {
      setBanner({ tone: 'error', text: e instanceof Error ? e.message : 'Preview failed.' });
    } finally {
      setBusy(null);
    }
  }

  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim());

  return (
    <View>
      {banner && (
        <Banner tone={banner.tone} onClose={() => setBanner(null)}>
          {banner.text}
        </Banner>
      )}

      <Card className="mb-4">
        <Field label="Send to" value={to} onChangeText={setTo} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} placeholder="name@example.com" />
        {(['weekly', 'monthly'] as TestReportType[]).map((type) => (
          <View key={type} className="mt-4">
            <Text className="text-sm font-bold text-neutral-900 mb-2">{type === 'weekly' ? 'Weekly report' : 'Monthly report'}</Text>
            <View className="gap-2">
              <Button
                label={`Send test ${type} report`}
                icon="send-outline"
                onPress={() => send(type)}
                busy={busy === `send-${type}`}
                disabled={!!busy || !validEmail}
              />
              <Button
                label="Download PDF preview"
                icon="document-outline"
                variant="secondary"
                onPress={() => preview(type)}
                busy={busy === `preview-${type}`}
                disabled={!!busy}
              />
            </View>
          </View>
        ))}
      </Card>

      <SectionTitle>Last 20 sends</SectionTitle>
      <Card>
        {logError ? (
          <Text className="text-sm text-red-700">{logError}</Text>
        ) : rows === null ? (
          <ActivityIndicator color={NAVY} />
        ) : rows.length === 0 ? (
          <Text className="text-sm text-neutral-500">No test reports sent yet.</Text>
        ) : (
          rows.map((r, i) => (
            <View key={r.id} className={`flex-row items-center gap-3 py-2.5 ${i > 0 ? 'border-t border-neutral-100' : ''}`}>
              <View className="flex-1">
                <Text className="text-sm font-semibold text-neutral-900" numberOfLines={1}>
                  {r.recipient}
                </Text>
                <Text className="text-xs text-neutral-500">
                  {fmt(r.created_at)} · {r.type === 'weekly' ? 'Weekly' : 'Monthly'}
                  {r.error ? ` · ${r.error}` : ''}
                </Text>
              </View>
              <Text
                className="text-xs font-bold px-2 py-0.5 rounded-full overflow-hidden"
                style={{ color: r.status === 'sent' ? '#166534' : '#B91C1C', backgroundColor: r.status === 'sent' ? '#F0FDF4' : '#FEF2F2' }}
              >
                {r.status === 'sent' ? 'Sent' : 'Failed'}
              </Text>
            </View>
          ))
        )}
      </Card>
    </View>
  );
}

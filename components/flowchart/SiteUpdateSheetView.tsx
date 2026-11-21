import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Text } from '../ui/AppText';
import { downloadSiteUpdateExcel, sheetDate, SITE_UPDATE, SITE_UPDATE_HEADERS } from '../../lib/siteUpdate';

// "Site Update" tab: the PMC site update sheet as a table, view only (no flowchart).
const COL_W = [52, 330, 96, 104, 88, 300];
const BORDER = '#9CA3AF';

function Cell({ w, children, bold, center, color, bg }: { w: number; children: string; bold?: boolean; center?: boolean; color?: string; bg?: string }) {
  return (
    <View style={{ width: w, borderRightWidth: 1, borderColor: BORDER, paddingHorizontal: 8, paddingVertical: 6, justifyContent: 'center', backgroundColor: bg }}>
      <Text className={`text-xs ${bold ? 'font-bold' : ''}`} style={{ textAlign: center ? 'center' : 'left', color: color ?? '#111827' }}>
        {children}
      </Text>
    </View>
  );
}

export function SiteUpdateSheetView() {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; isError: boolean } | null>(null);
  const total = SITE_UPDATE.groups.reduce((n, g) => n + g.rows.length, 0);

  async function download() {
    setBusy(true);
    setNote(null);
    try {
      const msg = await downloadSiteUpdateExcel();
      setNote({ text: msg || 'Excel file downloaded', isError: false });
    } catch (err) {
      setNote({ text: `Could not create the Excel file: ${err instanceof Error ? err.message : String(err)}`, isError: true });
    } finally {
      setBusy(false);
    }
  }

  const tableW = COL_W.reduce((a, b) => a + b, 0) + 2;

  return (
    <View className="flex-1 bg-white">
      <View className="flex-row items-center gap-2 px-4 py-2 border-b border-neutral-100">
        <View className="flex-1">
          <Text className="text-sm font-bold text-neutral-900">{SITE_UPDATE.title}</Text>
          <Text className="text-2xs text-neutral-500">Date: {SITE_UPDATE.date} · {total} tasks · view only</Text>
        </View>
        <Pressable
          testID="site-update-download"
          onPress={download}
          disabled={busy}
          accessibilityRole="button"
          className="flex-row items-center gap-1.5 px-3 rounded-xl"
          style={{ minHeight: 40, backgroundColor: '#15803D', opacity: busy ? 0.6 : 1 }}
        >
          {busy ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="download-outline" size={16} color="#fff" />}
          <Text className="text-xs font-bold text-white">Download Excel</Text>
        </Pressable>
      </View>
      {note ? (
        <Pressable onPress={() => setNote(null)} className="px-4 py-2" style={{ backgroundColor: note.isError ? '#FEE2E2' : '#DCFCE7' }}>
          <Text className="text-xs font-semibold" style={{ color: note.isError ? '#B91C1C' : '#15803D' }}>{note.text}</Text>
        </Pressable>
      ) : null}

      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <ScrollView horizontal>
          <View style={{ width: tableW }}>
            {SITE_UPDATE.groups.map((group) => (
              <View key={group.title} style={{ borderWidth: 1, borderColor: BORDER, marginBottom: 20 }}>
                <View style={{ backgroundColor: '#E5E7EB', paddingVertical: 6, borderBottomWidth: 1, borderColor: BORDER }}>
                  <Text className="text-xs font-bold text-center" style={{ color: '#B91C1C' }}>{group.title}</Text>
                </View>
                <View className="flex-row" style={{ backgroundColor: '#F3F4F6', borderBottomWidth: 1, borderColor: BORDER }}>
                  {SITE_UPDATE_HEADERS.map((h, i) => (
                    <Cell key={h} w={COL_W[i]} bold center>{h}</Cell>
                  ))}
                </View>
                {group.rows.map((row, i) => (
                  <View key={row.sNo} className="flex-row" style={{ borderBottomWidth: i === group.rows.length - 1 ? 0 : 1, borderColor: BORDER }}>
                    <Cell w={COL_W[0]} center>{String(row.sNo)}</Cell>
                    <Cell w={COL_W[1]}>{row.description}</Cell>
                    <Cell w={COL_W[2]} center>{sheetDate(row.planned)}</Cell>
                    <Cell w={COL_W[3]} center>{sheetDate(row.estimated)}</Cell>
                    <Cell w={COL_W[4]} center bold color="#B91C1C">{String(row.delayedBy)}</Cell>
                    <Cell w={COL_W[5]}>{row.remark}</Cell>
                  </View>
                ))}
              </View>
            ))}
            <Text className="text-2xs font-bold text-center text-neutral-500">{SITE_UPDATE.footer}</Text>
          </View>
        </ScrollView>
      </ScrollView>
    </View>
  );
}

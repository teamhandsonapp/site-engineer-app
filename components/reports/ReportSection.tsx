import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { Card } from '../ui/Card';

// Thin Card + title/subtitle shell reused by every one of the 12 report
// parameters, so each report screen is just a list of these. Title is
// optional — omitting it (General Parameter's own card, by explicit
// request) skips both the heading and its reserved spacing, rather than
// rendering an empty line.
export function ReportSection({ title, subtitle, children }: { title?: string; subtitle?: string; children: ReactNode }) {
  return (
    <Card className="mb-3">
      {title && <Text className="text-xs font-bold uppercase tracking-wide text-neutral-400">{title}</Text>}
      {subtitle ? (
        <Text className="text-2xs text-neutral-400 mt-0.5 mb-2.5">{subtitle}</Text>
      ) : title ? (
        <View style={{ height: 10 }} />
      ) : null}
      {children}
    </Card>
  );
}

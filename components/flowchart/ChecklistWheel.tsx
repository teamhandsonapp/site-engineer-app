import Svg, { Circle, Line } from 'react-native-svg';
import { CHECKLIST_NOTE_FIELDS, STAGED_NOTE_FIELDS } from '../../lib/flowchart/checklistNotes';

// Client-checklist icon (Flowchart 2, 2026-11-14): a wheel with one dot per checklist point (7) — one
// per checklist point (Architect, Consultant, Client, Procurement status,
// Lead time, Other), clockwise from the top. A point that has something
// written is a dot filled in that point's own colour (CHECKLIST_NOTE_FIELDS);
// an empty point is a small hollow dot.
// `fields`: Past Tasks passes STAGED_NOTE_FIELDS (adds Equipment delays).
export function ChecklistWheel({ size, filled, color = '#111827', fields = filled.length > CHECKLIST_NOTE_FIELDS.length ? STAGED_NOTE_FIELDS : CHECKLIST_NOTE_FIELDS }: { size: number; filled: boolean[]; color?: string; fields?: typeof CHECKLIST_NOTE_FIELDS }) {
  const c = 12; // drawn in a 24x24 box
  const R = 9;
  const stroke = 1.3;
  const dots = fields.map((f, i) => {
    const a = (-90 + (i * 360) / fields.length) * (Math.PI / 180);
    return { x: c + R * Math.cos(a), y: c + R * Math.sin(a), on: !!filled[i], tone: f.color };
  });
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={c} cy={c} r={R} fill="none" stroke={color} strokeWidth={stroke} />
      {dots.map((d, i) => (
        <Line key={`l${i}`} x1={c} y1={c} x2={d.x} y2={d.y} stroke={color} strokeWidth={stroke} />
      ))}
      <Circle cx={c} cy={c} r={3} fill="#fff" stroke={color} strokeWidth={stroke} />
      {dots.map((d, i) =>
        d.on ? (
          <Circle key={`d${i}`} cx={d.x} cy={d.y} r={2.9} fill={d.tone} stroke="#fff" strokeWidth={0.8} />
        ) : (
          <Circle key={`d${i}`} cx={d.x} cy={d.y} r={1.9} fill="#fff" stroke={color} strokeWidth={stroke} />
        )
      )}
    </Svg>
  );
}

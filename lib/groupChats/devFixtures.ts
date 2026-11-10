// DEV ONLY: sample messages for app/site-groups/preview.tsx, so the chat UI
// can be checked (and screenshotted) with every kind of message without
// writing anything to the database. Never imported by release code paths.

import type { ChatMessage, MessageStatus, MessageType } from './types';

const REPORT = `Daily site report — Block A, ${'level 4'}

1. Concrete: slab pour for grid C–F completed at 14:20. 38 m³ M30 received in 6 transit mixers, slump checked on every truck (100–110 mm). Cubes cast: 6 sets, marked A4-SL-01 to 06.
2. Shuttering: column C4 and C5 shuttering struck, faces good, minor honeycombing on C5 north face — to be patched tomorrow with polymer mortar.
3. Reinforcement: beams B12–B15 bar bending checked against drawing S-101 R2. Two stirrups missing at B14 support, fixed before pour.
4. Manpower: 42 on site (carpenters 12, bar benders 9, masons 8, helpers 13). Two absent.
5. Safety: toolbox talk on working at height. One harness replaced (frayed lanyard). No incidents.
6. Materials: cement 180 bags in stock, steel 12 mm running low — please raise PO today.
7. Tomorrow: curing of today's slab, start blockwork on level 3 east side, receive 2 loads of AAC blocks.

Photos of the pour are uploaded in the DPR.`;

let seq = 0;
function msg(minAgo: number, from: { me?: boolean; name: string; wa?: string }, body: string | null, opts: { type?: MessageType; status?: MessageStatus; error?: string } = {}): ChatMessage {
  seq++;
  return {
    id: `preview-${seq}`,
    group_id: 'preview',
    wa_message_id: `wa-preview-${seq}`,
    client_message_id: null,
    from_me: !!from.me,
    sender_wa_id: from.me ? null : from.wa ?? from.name,
    sender_name: from.name,
    type: opts.type ?? 'text',
    body,
    status: opts.status ?? (from.me ? 'read' : 'received'),
    error: opts.error ?? null,
    wa_timestamp: new Date(Date.now() - minAgo * 60_000).toISOString(),
  };
}

export function sampleMessages(myName: string): ChatMessage[] {
  const me = { me: true, name: myName };
  const staff = { me: true, name: 'Chandraprakash' };
  const ravi = { name: 'Ravi Kumar', wa: '919800000011' };
  const sup = { name: 'Site Supervisor', wa: '919800000012' };
  const anil = { name: 'Anil (Electrical)', wa: '919800000013' };
  const unknown = { name: '+91 98765 43210', wa: '919876543210' };
  const day = 24 * 60;
  const list = [
    msg(day + 300, ravi, 'Good morning team. Pour for level 4 slab confirmed for today 11 AM.'),
    msg(day + 298, ravi, 'RMC plant says first truck leaves at 10:15.'),
    msg(day + 290, me, 'Noted. Please keep the cube moulds ready and check slump on every truck.', { status: 'read' }),
    msg(day + 200, sup, 'Column C4 shuttering', { type: 'image' }),
    msg(day + 199, sup, null, { type: 'document' }),
    msg(day + 120, staff, 'Consultant visit moved to Thursday 3 PM. Drawings: https://www.teamhandson.com/drawings/S-101', { status: 'delivered' }),
    msg(day + 60, unknown, 'Sir this is the steel supplier, call me on +91 98765 43210 or mail sales@steelco.in'),
    msg(185, ravi, REPORT),
    msg(150, anil, null, { type: 'audio' }),
    msg(149, anil, 'Conduit for level 4 is done, ready for inspection.'),
    msg(120, me, '👍'),
    msg(95, sup, '🎉🎉'),
    msg(60, me, 'Great work everyone. Curing to start tonight, two shifts.', { status: 'read' }),
    msg(59, me, 'Ravi, please send the cube test schedule.', { status: 'delivered' }),
    msg(58, me, 'And the pour register photo.', { status: 'sent' }),
    msg(30, ravi, 'Sure sir, sending by evening.'),
    msg(26, sup, 'Block B update:'),
    msg(26, sup, 'Water tank is at 40%.'),
    msg(25, sup, 'Pump started at 4:10 PM.'),
    msg(25, sup, 'Will check again at 6.'),
    msg(24, sup, 'Plumber coming tomorrow 9 AM for the inlet valve.'),
    msg(20, sup, 'Level 4 slab after pour', { type: 'image' }),
    msg(12, staff, 'PO for 12 mm steel raised: PO-2026-0412', { status: 'sent' }),
    msg(3, me, 'Can someone check the water tank level at Block B?', { status: 'failed', error: 'Not sent' }),
    msg(1, me, 'Leaving site now, call if anything urgent.', { status: 'sending' }),
  ];
  return list.reverse(); // newest first, like the real list
}

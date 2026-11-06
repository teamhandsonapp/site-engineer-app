# Site Groups chat — design spec

Status: **draft for review** (Step 0). Branch `feature/whatsapp-groups`.
Scope: the Site Groups list and chat screens in the mobile app. UI only for
Steps 1–9 — data fetching, realtime, cache, send flow, database and Edge
Functions stay as they are.

Before screenshots: `~/Downloads/pmc-portal/screenshots/site-groups/before/`
(390 × 844, light + dark — dark is identical today, see "Dark mode" below).

---

## 1. What we build on

| Library | Version | Use |
|---|---|---|
| react-native-reanimated | 4.5.1 (+ worklets 0.10.1) | bubble enter, send-button scale, floating date chip, scroll button |
| react-native-gesture-handler | 2.32.0 | swipe to reply (Step 10 only) |
| react-native-svg | 15.15.4 | nothing new planned; background tile is a PNG |
| expo-haptics | 57.0.3 | send, long-press, swipe threshold |
| @react-native-async-storage/async-storage | 2.2.0 | drafts per group |
| expo-clipboard | 57.0.2 | Copy |
| react-native-safe-area-context | 5.7.0 | composer / header insets |
| @expo/vector-icons (Ionicons) | 15 | ticks, header, media rows |
| **expo-image** | **not installed** | not needed: the 256 px tile uses RN `ImageBackground` with `resizeMode="repeat"` |

No new native libraries are planned.

## 2. Findings that shape the design

1. **The app is locked to light mode** (`app.json → userInterfaceStyle: "light"`;
   nothing uses `useColorScheme`). Dark tokens below will be built, but they
   only appear if the app is allowed to follow the phone's theme — **decision
   needed** (section 12).
2. **Mute and "Site Groups Setup" don't exist yet** (Prompt 3 not built: no
   mute RPC, no setup screen). Per "no fake or non-working sections" they are
   left out of the ⋯ menu and Group Info until they exist.
3. **"Linked since"**: the group table has no linked-at date; we can show
   *"Added on <created_at>"* — or drop the line.
4. **Message info**: we store status + one timestamp only (no separate
   delivered/read times). Message info shows *status* and *sent time*.
5. **Outgoing = our company number.** Everyone in the app who can send sends
   through the same number, so "outgoing" bubbles may come from different
   staff. Proposal: on outgoing runs sent by someone *other than me*, show
   their name (small, muted) on the first bubble — "You" is never shown.
6. **Android keyboard** is `softwareKeyboardLayoutMode: "pan"` (not changing
   app.json). Keep `KeyboardAvoidingView` for iOS; on Android rely on pan +
   inverted list, and verify on a phone.
7. **Unread divider** position comes from the list's `unread_count` (already
   loaded) at the moment the chat opens — no new query.
8. **Search (Step 7)** needs one server query (`ilike` on body, this group,
   limit 50). For large groups a trigram index would help — I'll report, not
   add.

## 3. Colour tokens (`lib/theme.ts → chat`, light / dark)

All text pairs ≥ 4.5:1 (checked). Icons ≥ 3:1.

| Token | Light | Dark | Notes |
|---|---|---|---|
| `chatBg` | `#EDF0F4` | `#0B111B` | behind the pattern |
| `patternInk` | navy `#0F1F33` @ 5 % | white @ 4 % | baked into the tile PNGs |
| `incomingBg` | `#FFFFFF` | `#172131` | |
| `outgoingBg` | `#E3EBF5` (soft navy tint) | `#1F3A63` (deeper navy) | replaces today's amber-soft |
| `bubbleText` in / out | `#111827` / `#0F1F33` | `#E7ECF3` / `#F3F6FA` | 15–17:1 / 12:1 |
| `metaText` in / out | `#5B6472` / `#4B5768` | `#9AA6B8` / `#B4C0D3` | time |
| `tickMuted` (sending/sent/delivered) | = meta | = meta | |
| `tickRead` | `#B45309` (amber, 4.2:1 icon) | `#F2B347` | **not** blue |
| `failed` | `#B91C1C` | `#FCA5A5` | icon + "Not sent · tap to retry" |
| `link` in / out | `#1D4ED8` | `#8AB4FF` / `#A9C7FF` | underlined |
| `dateChipBg` / text | `#FFFFFF` / `#374151` | `#1A2433` / `#C9D2DE` | + soft shadow (iOS) / 1 px border (Android) |
| `unreadDividerBg` / text | `#FEF5E4` / `#B45309` | `#2B2213` / `#F2B347` | full-width bar |
| `composerBar` / input | `#FFFFFF` / `#F1F3F6` | `#111A27` / `#1A2433` | |
| `sendButton` | `#F0A227`, icon navy | `#F0A227`, icon navy | orange only when there's text |
| `badge` (unread, new msgs) | `#F0A227`, text navy `#0F1F33` | same | navy on orange = 8:1 |
| `senderPalette` (8) | `#1D4ED8 #B45309 #7C3AED #0F766E #BE185D #4D7C0F #C2410C #1C3358` | `#8AB4FF #F2B347 #C4A5FF #5EEAD4 #F9A8D4 #A3E635 #FDBA74 #B4C3F5` | same index in both modes; avatar circles use the same colour at 15 % behind initials |

Tailwind mirror: the chat screens use `StyleSheet` + tokens only, so no
Tailwind additions are needed (will add a `chat` block if any NativeWind
class is used).

## 4. Background

- Two 256 × 256 PNG tiles (light/dark), **≤ 20 KB each**, our own line icons:
  hard hat, crane, ruler, brick, spirit level, scattered and rotated, 1.5 px
  strokes, 4–5 % opacity.
- Rendered once with `ImageBackground resizeMode="repeat"` *behind* the
  FlatList, in a memoised component with no props → never re-renders when
  messages arrive. No full-screen SVG, no screen-sized bitmap.

## 5. Spacing and type (4/8-pt grid, IBM Plex Sans)

| Element | Size / line | Weight |
|---|---|---|
| Message text | 15 / 21 | Regular |
| Emoji-only (1–3) | 40 / 48, no bubble | — |
| Sender name | 13 / 18 | SemiBold, palette colour |
| Time inside bubble | 11 / 14 | Regular, meta colour |
| Date chip | 12 / 16 | Medium |
| Unread divider | 13 / 18 | SemiBold |
| List: group name | 16 / 22 | SemiBold (Bold if unread) |
| List: preview | 14 / 20 | Regular |
| List: time | 12 / 16 | Regular (SemiBold + orange if unread) |
| Header title / subtitle | 17 / 22 SemiBold · 12 / 16 Regular | |

Screen gutter 12; bubble-to-avatar gap 6; list row height 72 (avatar 46 ≈ 64 %);
separators inset to the text (left 12 + 46 + 12 = 70).

## 6. Bubbles

- Max width **78 %** of the screen; padding **8 × 12**; radius **16**.
- **Tail**: first bubble of a run only — a small 8 × 10 notch at the top
  corner (incoming top-left, outgoing top-right), drawn with a rotated
  square in the bubble colour (no SVG per bubble).
- **Runs**: same sender and ≤ 5 min apart → 2 pt gap, no tail, no name.
  New sender or > 5 min → 8 pt gap. Flags precomputed in `buildItems`.
- **Meta inside the bubble, bottom-right**: time + tick. Space is reserved by
  an invisible spacer at the end of the last text line (the usual chat trick)
  so text wraps around it and never overlaps.
- **Ticks** (Ionicons, 15 pt): `time-outline` sending · `checkmark` sent ·
  `checkmark-done` delivered (muted) · `checkmark-done` read (accent) ·
  `alert-circle` failed (red) + "Not sent · tap to retry" under the bubble.
- **Incoming**: sender name on first bubble of a run (palette colour);
  28 pt initials avatar beside the **last** bubble of the run (spacer on the
  others so bubbles stay aligned).
- **Long text**: first ~900 chars + "Read more" (expands in place, per
  bubble state).
- **Emoji-only** (1–3 grapheme emoji): large, no bubble, meta in a small
  translucent pill.
- **Links / phones / emails**: detected once per message (memoised), shown
  as link colour + underline; tap → confirm sheet ("Open link?", the URL,
  Open / Cancel) for web links; phone → dialer, email → mail app.
- **Media placeholders**: one row inside the bubble — 36 pt rounded icon
  tile (`image-outline`, `videocam-outline`, `document-text-outline`,
  `mic-outline`, `happy-outline` sticker) + label ("Photo"), caption below.
- **Selectable text** only via long-press → "Select text" (opens a sheet
  with selectable text), never by default.
- **Shadow**: iOS hairline shadow (opacity 0.05, radius 1); Android: no
  elevation, a 0.5 px border in a slightly darker tint instead.
- Bubbles stay `React.memo` with the narrow compare; new props are scalar
  flags only.

## 7. Date chips, unread divider, scroll button

- Centred chip between days: "Today", "Yesterday", "Mon, 3 Nov"
  (+ year if not this year).
- Floating chip at the top while scrolling (date of the top visible
  message, from `onViewableItemsChanged`), Reanimated fade-out 1 s after
  momentum ends.
- Unread divider "N unread messages" above the first unread incoming
  message; on open, scroll so it sits near the top; stays until leaving.
- Scroll-to-bottom: 44 pt round button, bottom-right, 12 pt above the
  composer, appears after > 1 screen height; orange badge with new-message
  count; tap → animated scroll to newest.
- At bottom → new messages slide into view; scrolled up → only the badge
  counts.

## 8. Composer

- Raised bar (top hairline + soft shadow), pill input radius 22, min height
  44, grows to 5 lines then scrolls; placeholder "Message".
- Send: 44 pt circle, orange with navy icon when there's text; hidden when
  empty (input takes the width); Reanimated press scale 0.9 → 1;
  `Haptics.impactAsync(Light)`.
- No attach / camera / mic.
- Drafts: AsyncStorage `siteGroups:draft:<groupId>`, saved debounced 400 ms,
  restored on open, cleared on send; list shows "Draft: …" in orange.
- Bottom safe-area padding when the keyboard is closed; none when open.
- Read-only: slim 44 pt bar, lock icon, "Only people with send permission
  can reply."

## 9. Header, Group info, Search

- **Header** (navy): back · 36 pt group avatar (initials, colour from name
  hash) · name (1 line, ellipsis) · subtitle = project name · bell-off icon
  if muted (once mute exists). Tap name/avatar → Group info.
  ⋯ menu: **Search**, **Group info** (Mute / Setup added when they exist).
- **Group info**: 88 pt avatar, name, project, "Added on <date>" (see
  finding 3), "People in this chat" = distinct senders in the newest
  500 messages (one limited query) with initials + message count, with the
  note "Based on recent messages — not the full member list."
- **Search**: header turns into a search field; 300 ms debounce; one query
  (group, `ilike`, limit 50, newest first); results show sender, date,
  highlighted match; tap → load around that message, scroll, 1.2 s
  highlight.

## 10. Chat list

Row 72 pt: 46 pt initials avatar · name (Bold if unread) + time (orange if
unread) · preview ("Ravi: …", "You: ✓✓ …", orange "Draft: …", media type
icon) + unread pill (orange, navy text, "99+") + bell-off if muted.
Search field on top (filters by name, local). Separators inset to the text.
Pressed state = `surfaceMuted`. Pull to refresh. Empty state: large
`chatbubbles-outline` in a soft circle + "No site groups for this project
yet."

## 11. States and motion

| State | Look |
|---|---|
| Loading list / chat | skeleton rows / skeleton bubbles (alternating left/right, real widths) |
| Offline | existing `OfflineBanner` restyled as a slim bar under the header |
| Error | existing `ErrorState` (unchanged behaviour) |
| Empty chat | icon + "No messages yet" |
| New message while open | 180 ms fade + 8 pt slide-up (Reanimated `entering`), only for messages that arrive live |
| Long-press | haptic + scale 0.97 → 1, sheet: Copy · Select text · Message info · Retry/Delete (failed) |

Durations ≤ 220 ms; respect "Reduce motion" (skip enter animations).

## 12. Decisions needed before Step 1

1. **Dark mode**: the app is locked to light. Options:
   a) build dark tokens now, but they show only after the app follows the
      phone theme (an `app.json` change + the rest of the app made
      dark-ready later);
   b) let only the Site Groups screens follow the phone theme now (the rest
      of the app stays light) — needs `userInterfaceStyle: "automatic"`,
      and every other screen would need forcing to light.
   Recommendation: **(a)** — build and screenshot dark (forced in the web
   build), switch on app-wide later.
2. **Outgoing staff names** (finding 5): show the sender's name on outgoing
   runs from other staff? Recommendation: **yes**.
3. **Screenshots with the composer** need a test user who can send. The test
   owner's access row was removed by the last test run; restoring it is a
   one-row live write. Until then screenshots use the read-only member.

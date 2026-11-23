# WhatsApp

## MoM meeting invites — Meta Cloud API test (dev only)

When `EXPO_PUBLIC_WA_TEST=true`, the **Send WhatsApp** button on a meeting's
**Invite** card (MoM › Meeting › open a meeting › Invite) sends the invite
from the Meta test number straight away — no WhatsApp window opens. This is a
test before meetings move to Supabase. It does not touch the Site Groups /
Whapi number.

### How it works

1. Saving a meeting only saves it (nothing is sent on save — one send path,
   so nobody gets the same invite twice).
2. On the Invite card, tick the people to message and tap **Send WhatsApp to N
   people**. The app calls the Supabase Edge Function `send-meeting-whatsapp`
   with the title, project, date, time, venue and the ticked invitees.
3. The function (logged-in users only):
   - turns phones into digits with country code (`+91 81110 41101` → `918111041101`;
     a bare 10-digit number is treated as +91);
   - skips numbers not in `META_WA_TEST_ALLOWLIST` (reported as "not in test list");
   - sends one template message per person to
     `https://graph.facebook.com/v25.0/{PHONE_NUMBER_ID}/messages`;
   - returns sent / failed / skipped per person with a plain-English error
     (190 token expired, 131030 not in allowed list, 132001 template missing
     or not approved, 132000 wrong parameter count).
4. Each person's row then shows **Sent 10:42 AM**, **Failed — reason** or
   **Skipped — not in test list**. Sent ones are added to the card's SENT
   history as "WhatsApp API (test number)" (old link sends just say "WhatsApp").
5. **Open in my WhatsApp** (small link under the button) still opens the old
   wa.me chats, for when the API fails.

With the flag off (or missing) the card works exactly as before (wa.me chats only).
After changing `.env.local`, restart Expo with `npx expo start -c`.

### Files

| What | Where |
|---|---|
| Edge Function | `supabase/functions/send-meeting-whatsapp/index.ts` |
| App call + flag | `lib/mom/whatsappTest.ts`, `components/mom/MeetingTab.tsx` |
| Invite card (button, per-person result) | `components/mom/SendPanel.tsx` |
| Secrets (git-ignored) | `.env.meta.local` |
| App flag (git-ignored) | `.env.local` → `EXPO_PUBLIC_WA_TEST=true` |

### Secrets (`.env.meta.local`, never committed)

```
META_WA_TOKEN=...                 # Meta access token (test tokens last 24 h)
META_WA_PHONE_NUMBER_ID=...       # WhatsApp › API Setup › Phone number ID
META_WA_WABA_ID=...               # WhatsApp Business Account ID
META_WA_TEMPLATE=hello_world      # later: meeting_invite
META_WA_TEMPLATE_LANG=en_US       # hello_world = en_US, meeting_invite = en
META_WA_TEST_ALLOWLIST=918111041101,91XXXXXXXXXX   # numbers verified in Meta
META_WA_ALLOW_TEXT_FALLBACK=false # true = try plain text if the template fails
```

### Deploy (run in the project folder)

```
npx supabase login
npx supabase link --project-ref rkccoznjdexlgvzqkhgg
npx supabase secrets set --env-file .env.meta.local
npx supabase functions deploy send-meeting-whatsapp
```

After changing any value in `.env.meta.local` (new token, new allowlist
number, new template) run only the `secrets set` line again — no redeploy
and no app rebuild needed.

### Switching hello_world → meeting_invite

1. In Meta, create the template `meeting_invite` (language **English**, `en`)
   with **6 body variables in this order**:
   `{{1}}` invitee name, `{{2}}` meeting title, `{{3}}` project name,
   `{{4}}` date (e.g. 15 Nov 2026), `{{5}}` time (e.g. 10:00 AM, India time),
   `{{6}}` venue.
2. When it is approved, set `META_WA_TEMPLATE=meeting_invite` and
   `META_WA_TEMPLATE_LANG=en`, then run `npx supabase secrets set --env-file .env.meta.local`.

### Moving from the test number to the real number

Only two values change: `META_WA_PHONE_NUMBER_ID` (the real number's ID) and
`META_WA_TOKEN` (a permanent System User token). Re-run `secrets set`. The
allowlist only exists for testing — remove that check from the function
when going live, so every invitee is messaged.

### Turning the test off

Remove `EXPO_PUBLIC_WA_TEST=true` from `.env.local` (or set it to `false`) and
restart `npx expo start`. For phone builds the flag is read at build time.

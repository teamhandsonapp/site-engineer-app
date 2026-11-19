# Google Calendar for MoM meetings

When a MoM meeting is saved with **Add to Google Calendar** on, the app puts it
in one company Google Calendar and Google emails the invite to every invitee who
has an email address. Editing the meeting updates the event; deleting the
meeting (or switching the toggle off) cancels it, and Google emails the change.

How it works: the app calls the Supabase Edge Function `sync-meeting-calendar`.
The company Google login is stored only in Supabase secrets, never in the app.
Only Admin and Manager accounts can use it (same as the MoM screen).

## One-time setup (about 15 minutes)

### 1. The Google account
Use the company Gmail that should own the meetings (the organiser shown in
everyone's invite). Sign in to it in your browser for the next steps.

### 2. Google Cloud project
1. Open https://console.cloud.google.com and create a project, e.g. `PMC Portal`.
2. **APIs & Services → Library** → search **Google Calendar API** → **Enable**.

### 3. Consent screen (important)
1. **APIs & Services → OAuth consent screen** (or **Google Auth Platform**).
2. User type **External**. App name `PMC Portal`, support email = the company Gmail.
3. Scopes: add `https://www.googleapis.com/auth/calendar.events`.
4. **Publish the app** (status **In production**). Do not leave it in
   *Testing*: in Testing, Google cancels the login after 7 days and the sync
   stops. Google verification is **not** needed, because only your own account
   signs in.

### 4. Login for the server (refresh token)
1. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
   Type **Web application**. Authorised redirect URI:
   `https://developers.google.com/oauthplayground`. Copy the **Client ID** and
   **Client secret**.
2. Open https://developers.google.com/oauthplayground. Click the gear icon,
   tick **Use your own OAuth credentials**, paste the Client ID and secret.
3. In *Step 1*, type `https://www.googleapis.com/auth/calendar.events`, click
   **Authorize APIs** and sign in with the company Gmail. Google warns the app
   isn't verified: click **Advanced → Go to PMC Portal** and allow.
4. In *Step 2*, click **Exchange authorization code for tokens** and copy the
   **Refresh token**.

### 5. Save the secrets and deploy
From the project folder:

```bash
npx supabase secrets set GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... GOOGLE_REFRESH_TOKEN=...
# Optional: a separate calendar instead of the main one
# npx supabase secrets set GOOGLE_CALENDAR_ID=xxxx@group.calendar.google.com
npx supabase functions deploy sync-meeting-calendar
```

### 6. Test
Create a MoM meeting with yourself as an invitee (with your email) and
**Add to Google Calendar** on. The meeting page should show
"In Google Calendar · invite emailed to 1 person", and the invite arrives by email.

## If something goes wrong
The meeting page shows the reason in red with a **Retry Google Calendar** button.

| Message | Fix |
|---|---|
| not switched on yet / function not deployed | Do step 5 |
| not set up yet (GOOGLE_… missing) | Secrets missing: step 5 |
| login has expired or was removed | Redo step 4, then set the new `GOOGLE_REFRESH_TOKEN`. Check the consent screen is **In production** (step 3) |
| calendar was not found | Wrong `GOOGLE_CALENDAR_ID`, or remove it to use the main calendar |
| limit reached | Google limits how many invites one account sends per day; try later |

Notes
- Invitees without an email in the Contact Book don't get a Google invite (the
  meeting page says how many). WhatsApp invites are unchanged.
- MoM meetings are still saved on the phone that created them; the calendar
  event is linked to that meeting.
- Revoking access: in the company Google account, **Security → Third-party
  access → PMC Portal → Remove**.

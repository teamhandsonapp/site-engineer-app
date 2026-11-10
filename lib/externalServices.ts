// External Services: every outside service the PMC apps depend on, shown in
// PMC Portal > External Services. Edit this list to update the screen.
//
// Never put passwords or API keys here: this file ships inside the app.
// `account` is only WHO owns the login (e.g. an email), and `keysIn` says
// where the secret is kept.
//
// `cost` values marked "list price" are the provider's published starting
// price, not what this project is actually paying. Replace them with the real
// plan once confirmed.

export type ExternalService = {
  name: string;
  usedFor: string;
  usedBy: ('Site Engineer App' | 'Admin Web')[];
  paid: 'Free' | 'Paid' | 'Free tier, paid if usage grows' | 'Not live yet';
  cost: string;
  account: string;
  keysIn: string;
  status: 'Live' | 'Not live yet';
};

export const EXTERNAL_SERVICES: ExternalService[] = [
  {
    name: 'Supabase',
    usedFor: 'Database, user login, file storage and server functions',
    usedBy: ['Site Engineer App', 'Admin Web'],
    paid: 'Free tier, paid if usage grows',
    cost: 'Pro plan from $25/month (list price)',
    account: 'To confirm',
    keysIn: '.env.local (app and admin web)',
    status: 'Live',
  },
  {
    name: 'Expo / EAS',
    usedFor: 'Building the Android and iOS app, push notifications',
    usedBy: ['Site Engineer App'],
    paid: 'Free tier, paid if usage grows',
    cost: 'Free tier; paid plans from $19/month (list price)',
    account: 'To confirm',
    keysIn: 'Expo account (eas.json)',
    status: 'Live',
  },
  {
    name: 'Firebase (Google)',
    usedFor: 'Delivering push notifications to Android phones',
    usedBy: ['Site Engineer App'],
    paid: 'Free',
    cost: 'Free',
    account: 'To confirm',
    keysIn: 'google-services.json',
    status: 'Live',
  },
  {
    name: 'Sentry',
    usedFor: 'Crash and error reports from the app',
    usedBy: ['Site Engineer App'],
    paid: 'Free tier, paid if usage grows',
    cost: 'Free tier; Team plan from $26/month (list price)',
    account: 'To confirm',
    keysIn: '.env.local (EXPO_PUBLIC_SENTRY_DSN)',
    status: 'Live',
  },
  {
    name: 'Resend',
    usedFor: 'Sending emails: reports, alerts, user invites',
    usedBy: ['Admin Web'],
    paid: 'Free tier, paid if usage grows',
    cost: 'Free up to 3,000 emails/month; Pro from $20/month (list price)',
    account: 'To confirm',
    keysIn: 'Admin web .env.local (RESEND_API_KEY)',
    status: 'Live',
  },
  {
    name: 'Google Maps',
    usedFor: 'Site location maps',
    usedBy: ['Admin Web'],
    paid: 'Free tier, paid if usage grows',
    cost: 'Free monthly usage allowance, then pay per use (list price)',
    account: 'To confirm',
    keysIn: 'Admin web .env.local (NEXT_PUBLIC_GOOGLE_MAPS_API_KEY)',
    status: 'Live',
  },
  {
    name: 'Vercel',
    usedFor: 'Hosting the admin web',
    usedBy: ['Admin Web'],
    paid: 'Free tier, paid if usage grows',
    cost: 'Free tier; Pro from $20/user/month (list price)',
    account: 'To confirm',
    keysIn: 'Vercel account',
    status: 'Live',
  },
  {
    name: 'Google Play Console',
    usedFor: 'Publishing the Android app',
    usedBy: ['Site Engineer App'],
    paid: 'Paid',
    cost: '$25 one-time',
    account: 'To confirm',
    keysIn: 'secrets/google-play-service-account.json',
    status: 'Live',
  },
  {
    name: 'Apple Developer Program',
    usedFor: 'Publishing the iPhone app',
    usedBy: ['Site Engineer App'],
    paid: 'Paid',
    cost: '$99/year',
    account: 'To confirm',
    keysIn: 'Apple account (eas.json team ID)',
    status: 'Live',
  },
  {
    name: 'Whapi.Cloud (WhatsApp Site Groups)',
    usedFor: 'Connects one WhatsApp number so site group chats show in the app, and replies go back to WhatsApp',
    usedBy: ['Site Engineer App'],
    paid: 'Not live yet',
    cost: 'Paid monthly per connected number (plan to confirm)',
    account: 'Not set up',
    keysIn: 'Supabase Edge Function secrets (WHAPI_TOKEN, WHAPI_WEBHOOK_SECRET)',
    status: 'Not live yet',
  },
];

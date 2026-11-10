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

export type Billing = 'Yearly' | 'Monthly' | 'One-time' | 'Pay per use' | 'No charge';

export type ExternalService = {
  name: string;
  usedFor: string;
  usedBy: ('Site Engineer App' | 'Admin Web')[];
  paid: 'Free' | 'Paid' | 'Free tier, paid if usage grows' | 'Not live yet';
  cost: string;
  /** How often the bill comes. */
  billing: Billing;
  /** When / how it renews, and what happens if it is not renewed. */
  renewal: string;
  account: string;
  keysIn: string;
  status: 'Live' | 'Not live yet';
};

export const EXTERNAL_SERVICES: ExternalService[] = [
  {
    name: 'Apple Developer Program',
    usedFor: 'Publishing the iPhone app on the App Store',
    usedBy: ['Site Engineer App'],
    paid: 'Paid',
    cost: '$99 per year',
    billing: 'Yearly',
    renewal: 'Renews every year at $99. If not renewed, the iPhone app is removed from the App Store and cannot be updated.',
    account: 'To confirm',
    keysIn: 'Apple account (eas.json team ID)',
    status: 'Live',
  },
  {
    name: 'Website domain (teamhandson.com)',
    usedFor: 'Hosts the privacy policy page that Google Play requires and the app links to',
    usedBy: ['Site Engineer App'],
    paid: 'Paid',
    cost: 'Yearly domain fee (amount depends on the registrar, to confirm)',
    billing: 'Yearly',
    renewal: 'Renews every year with the domain registrar. If it lapses, the privacy policy link breaks and Google Play can flag the app.',
    account: 'To confirm',
    keysIn: 'Domain registrar account',
    status: 'Live',
  },
  {
    name: 'Google Play Console',
    usedFor: 'Publishing the Android app on Google Play',
    usedBy: ['Site Engineer App'],
    paid: 'Paid',
    cost: '$25 one-time',
    billing: 'One-time',
    renewal: 'No renewal. Paid once when the developer account was opened.',
    account: 'To confirm',
    keysIn: 'secrets/google-play-service-account.json',
    status: 'Live',
  },
  {
    name: 'Supabase',
    usedFor: 'Database, user login, file storage and server functions',
    usedBy: ['Site Engineer App', 'Admin Web'],
    paid: 'Free tier, paid if usage grows',
    cost: 'Free tier; Pro plan from $25/month (list price)',
    billing: 'Monthly',
    renewal: 'Pro plan bills every month. On the free plan there is no bill, but the project is paused after a week with no activity.',
    account: 'To confirm',
    keysIn: '.env.local (app and admin web)',
    status: 'Live',
  },
  {
    name: 'Expo / EAS',
    usedFor: 'Building the Android and iOS app, sending push notifications',
    usedBy: ['Site Engineer App'],
    paid: 'Free tier, paid if usage grows',
    cost: 'Free tier; paid plans from $19/month (list price)',
    billing: 'Monthly',
    renewal: 'Paid plans bill every month. The free plan has a limited number of app builds per month.',
    account: 'kabilan404 (Expo account in app.json)',
    keysIn: 'Expo account (eas.json)',
    status: 'Live',
  },
  {
    name: 'Google Maps',
    usedFor: 'Site location maps and the engineer day-trail map in the app',
    usedBy: ['Site Engineer App', 'Admin Web'],
    paid: 'Free tier, paid if usage grows',
    cost: 'Free monthly usage allowance, then pay per use (list price)',
    billing: 'Pay per use',
    renewal: 'Billed monthly to a Google Cloud billing account, only for usage above the free allowance. A card must stay on file.',
    account: 'To confirm',
    keysIn: 'app.json (Android) and admin web .env.local (NEXT_PUBLIC_GOOGLE_MAPS_API_KEY)',
    status: 'Live',
  },
  {
    name: 'Vercel',
    usedFor: 'Hosting the admin web and the privacy policy page',
    usedBy: ['Admin Web'],
    paid: 'Free tier, paid if usage grows',
    cost: 'Free tier; Pro from $20/user/month (list price)',
    billing: 'Monthly',
    renewal: 'Pro bills every month per team member. The free Hobby plan is for non-commercial use only, so client work should be on Pro.',
    account: 'To confirm',
    keysIn: 'Vercel account',
    status: 'Live',
  },
  {
    name: 'Sentry',
    usedFor: 'Crash and error reports from the app',
    usedBy: ['Site Engineer App'],
    paid: 'Free tier, paid if usage grows',
    cost: 'Free tier; Team plan from $26/month (list price)',
    billing: 'Monthly',
    renewal: 'Team plan bills every month. The free plan has a monthly error limit and 1 user.',
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
    billing: 'Monthly',
    renewal: 'Pro bills every month. The free plan resets each month (3,000 emails, 100 per day).',
    account: 'To confirm',
    keysIn: 'Admin web .env.local (RESEND_API_KEY)',
    status: 'Live',
  },
  {
    name: 'Firebase (Google)',
    usedFor: 'Delivering push notifications to Android phones',
    usedBy: ['Site Engineer App'],
    paid: 'Free',
    cost: 'Free',
    billing: 'No charge',
    renewal: 'No renewal. Push notifications are free.',
    account: 'To confirm',
    keysIn: 'google-services.json',
    status: 'Live',
  },
  {
    name: 'Whapi.Cloud (WhatsApp Site Groups)',
    usedFor: 'Connects one WhatsApp number so site group chats show in the app, and replies go back to WhatsApp',
    usedBy: ['Site Engineer App'],
    paid: 'Not live yet',
    cost: 'Paid monthly per connected number (plan to confirm)',
    billing: 'Monthly',
    renewal: 'Will bill every month per WhatsApp number once set up.',
    account: 'Not set up',
    keysIn: 'Supabase Edge Function secrets (WHAPI_TOKEN, WHAPI_WEBHOOK_SECRET)',
    status: 'Not live yet',
  },
];

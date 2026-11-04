import { Linking } from 'react-native';

// Public privacy policy page (privacy-policy-page/, deployed on Vercel).
// Google Play requires this link both on the store listing and inside the
// app — shown on the login screen and in the drawer footer.
export const PRIVACY_POLICY_URL = 'https://www.teamhandson.com/privacy-policy';

export function openPrivacyPolicy(): void {
  Linking.openURL(PRIVACY_POLICY_URL).catch(() => {});
}

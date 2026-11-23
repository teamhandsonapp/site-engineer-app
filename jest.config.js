// Unit tests (npm test). jest-expo handles TypeScript / React Native transforms.
module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
  testPathIgnorePatterns: ['/node_modules/', '/admin-web/', '/privacy-policy-page/'],
};

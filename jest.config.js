// Unit and component tests run under Jest (jest-expo). API and rules tests run under
// node:test via tsx (see package.json) so they stay free of the React Native environment.
module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/tests/unit/**/*.test.ts', '<rootDir>/tests/component/**/*.test.tsx'],
};

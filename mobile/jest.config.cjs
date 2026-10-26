module.exports = {
  preset: 'jest-expo',
  transformIgnorePatterns: [],
  // The first test of a suite pays the cold-start cost of loading react-native
  // and the screen under test; on shared CI runners that can exceed 15 seconds.
  testTimeout: 30000,
};

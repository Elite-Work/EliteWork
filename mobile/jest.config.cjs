module.exports = {
  preset: 'jest-expo',
  transformIgnorePatterns: [],
  // The first test of a suite pays the cold-start cost of loading react-native
  // and the screen under test; on shared CI runners that can exceed jest's 5s default.
  testTimeout: 15000,
};

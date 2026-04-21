module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/server/tests'],
  testMatch: ['**/*.test.js'],
  verbose: true,
  setupFiles: ['<rootDir>/jest.setup.js'],
};

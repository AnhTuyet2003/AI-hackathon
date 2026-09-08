const nextJest = require("next/jest.js");

const createJestConfig = nextJest({ dir: "./" });

/** @type {import('jest').Config} */
const customJestConfig = {
  preset: "ts-jest",
  clearMocks: true,
  testEnvironment: "node",
  moduleNameMapper: {
    "^@/(.*)\$": "<rootDir>/\$1",
  },
  testMatch: ["<rootDir>/test/**/*.test.ts"],
};

module.exports = createJestConfig(customJestConfig);

module.exports = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: ".",
  testRegex: ".*\\.spec\\.ts$",
  transform: {
    "^.+\\.(t|j)s$": [
      "ts-jest",
      { tsconfig: { allowJs: true, module: "commonjs" } }
    ]
  },
  // `uuid` (pulled in transitively by @langchain/langgraph-checkpoint)
  // ships pure ESM, so it must be transformed rather than ignored.
  transformIgnorePatterns: ["/node_modules/(?!uuid/)"],
  collectCoverageFrom: ["src/**/*.(t|j)s"],
  coverageDirectory: "./coverage",
  testEnvironment: "node"
};

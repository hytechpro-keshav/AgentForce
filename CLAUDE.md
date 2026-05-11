# Claude Project Context

Read `AGENTS.md` first. It is the canonical project guidance for this monorepo.

Use CodeTrellis for repository context when available:

- MCP server: `.vscode/mcp.json`
- Matrix cache: `.codetrellis/cache/AgentForce/matrix.prompt`
- CLI examples: `codetrellis context <file> --project .`, `codetrellis skills .`, `codetrellis scan . --optimal`

Do not duplicate Salesforce, NestJS, RAG, Open WebUI, React chat, security, or release rules here. Keep those rules in `AGENTS.md`, scoped `.github/instructions/*.instructions.md` files, and `docs/adr/`.

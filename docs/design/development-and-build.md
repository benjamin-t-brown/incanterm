# Development, build, and code quality

[Design index](../../README.md)

## Toolchain

Use TypeScript for the Node server and testing client, with browser code built through Vite. The root scaffold follows this toolchain. The game itself is not implemented yet.

| Part | Development | Production |
|---|---|---|
| Node game server | tsx watch | esbuild produces JavaScript, executed by Node |
| Node terminal client | tsx in a separate terminal | esbuild produces JavaScript, executed by Node |
| Browser client | Vite development server on 7103 and hot updates | vite build |
| Asset editor | Vite development server on 7104 | Vite |
| Tests | Vitest watch | vitest run |
| Type checking | Separate tsc --noEmit command | Required verification alongside build |
| Lint | ESLint | Check source without changing files |
| Formatting | Prettier | Check formatting without changing files |

Use ESLint and Prettier as the lint/format tools. Keep their responsibilities separate: ESLint checks code quality; Prettier owns formatting. Use eslint-config-prettier to disable conflicting ESLint formatting rules rather than running Prettier through ESLint. Use TypeScript-aware ESLint configuration for TypeScript sources. Exact dependency versions and rules will be selected when scaffolding.

## Planned commands

```text
npm run dev           Server and browser development processes
npm run client        Interactive Node terminal client, launched separately
npm run editor        Asset/scene editor
npm test              Vitest watch mode
npm run test:run       Tests once, suitable for CI
npm run typecheck      TypeScript checking without emitting files
npm run lint           ESLint check
npm run lint:fix       ESLint with automatic fixes
npm run format         Prettier write
npm run format:check   Prettier check
npm run build          Server, terminal client, and browser production builds
npm start              Built game server
```

The terminal client owns its terminal input/output; do not interleave it with server logs through the development process launcher. The Node testing client requires Node; standalone/native distribution remains deferred.

## Listeners and browser integration

The game server owns HTTP/REST/WebSocket on 7101 and SSH on 7102. The game Vite client uses 7103 and proxies API/WebSocket requests to 7101. The asset editor uses 7104 and serves its own `/api` from that same process. Neither Vite port is another public game-server listener. In production the game server serves the built browser assets. See [Clients and protocol](clients-and-protocol.md).

## Fast iteration

Keep transpilation and browser updates fast; do not block every edit on type checking, linting, formatting, coverage, or the entire test suite. Run type checking and checks explicitly or as independent processes. Editor formatting can use Prettier.

Code changes can restart the server or update browser modules. Asset and RPGScript changes should reload a preview session without rebuilding application code; see [Assets and scene editor](assets-and-scene-editor.md). Initial server restarts lose live sessions; the test client can offer to resume its latest local save.

Use Vitest as the primary test library, with Node environment by default. Prioritize meaningful tests for parser/runner behavior, player isolation, puzzles, saves, layers, rendering, and protocol handling. Add browser environments only for tests requiring them. Coverage is optional during everyday iteration. Imported RPGScript reference tests need adaptation before they can run here.

## Source boundaries and verification

Run ESLint and Prettier on maintained application, editor, test, configuration, and documentation files as appropriate. Ignore dependencies, generated build/coverage output, generated assets, and the unmodified `reference/rpgscript-regem-ludos/` source snapshot. Preserve original reference bytes and provenance. Art data and RPGScript assets need their own format-aware validation; do not pass unsupported formats to generic formatters.

When scaffolding, add root ESLint/Prettier configuration and ignore rules and make command scope explicit. Existing ed-ascii formatting changes should be deliberate rather than incidental to importing the tool. Do not copy the legacy editor extension's old lint/build configuration into the new application unchanged.

The normal verification set is formatting check, lint, type check, relevant tests, and production build. These check commands should not modify files; fixes are separate commands. CI can run the same checks. Root package scripts install the toolchain. CI configuration is not set up yet.

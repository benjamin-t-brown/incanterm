# Repository structure

- Put automated test files in a `__tests__/` directory inside the folder of the code they test (for example, `src/game/__tests__/scene.test.ts` for `src/game/scene.ts`). Do not place `*.test.ts` files beside source files.
- Keep shared test-only helpers in the relevant `__tests__/` directory as well. Update relative imports when adding or moving tests.

# Function names

- Give every named function an action verb that describes what the function actually does (including local helpers, function-valued variables and methods). Use `get` for value-returning helpers, `is`/`has`/`can` for predicates and a specific action such as `call`, `render`, or `parse` for commands. For example, use `getPlayerCharacterName`, not `playerCharacterName`, and `getWalkDestination`, not `walkDestination` when no walking occurs.
- Keep serialized data keys and external API names stable; when a callback key is fixed by a contract, give its implementation a verb-named function instead of renaming the contract.
- Run `npm run lint` to check this convention alongside Biome.

# Line endings

- Use LF line endings in every text file. Never write CRLF. `.gitattributes` and `.editorconfig` enforce this and Biome formats with `lineEnding: "lf"`.

# Repository instructions

- `@boyboni/firestore-query` binds the Firestore modular SDK to TanStack Query v5. Read `README.md` (especially "Design decisions") before changing behavior, and update it in the same change.
- Write code, comments, tests, and documentation in English.
- Keep the package ESM only, with `firebase`, `@tanstack/react-query`, and `react` as peer dependencies. Keep the peer ranges in `package.json` and the compatibility table in `README.md` in line with the CI matrix in `.github/workflows/ci.yml`.
- Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, and `pnpm check:package` for every change. Also run `pnpm test:emulator` (Java 21) when realtime listeners, pagination, invalidation, converters, or write hooks change. Report the checks you ran and anything left unverified.
- Write commit messages and pull request titles as Conventional Commits. Pull requests are merged with Squash and merge, so the title decides the version bump.
- Never edit `version`, `CHANGELOG.md`, or `.release-please-manifest.json` by hand; release-please owns them.

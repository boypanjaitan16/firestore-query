# Contributing

## Setup

Node 18 or later, pnpm 10, and Java 21 for the Firestore emulator.

```sh
pnpm install
```

## Scripts

| Script                      | What it does                                                                     |
| --------------------------- | -------------------------------------------------------------------------------- |
| `pnpm typecheck`            | TypeScript, no output                                                            |
| `pnpm lint` / `pnpm format` | Biome check, or check and fix                                                    |
| `pnpm test`                 | Unit tests with the Firestore SDK mocked                                         |
| `pnpm test:emulator`        | The suite against the Firestore emulator (firebase-tools 15.33.0 via `pnpm dlx`) |
| `pnpm build`                | ESM bundle and declarations in `dist`                                            |
| `pnpm check:package`        | `publint` and `attw` on the packed package                                       |

Run the emulator suite when you change realtime listeners, pagination, invalidation, or anything else the SDK mock cannot prove. CI runs it for every supported Firebase and React version.

## Commits and pull requests

- Write commit messages and pull request titles as [Conventional Commits](https://www.conventionalcommits.org/) (`feat: …`, `fix: …`, `feat!: …` for breaking changes).
- Pull requests are merged with **Squash and merge**. The title becomes the commit subject and decides the version bump, so give the pull request one type that covers the whole change.
- Before 1.0, `feat` bumps the minor version and `fix` bumps the patch version.

## Releases

[release-please](https://github.com/googleapis/release-please) keeps a Release PR open with the next version and `CHANGELOG.md`. Merging it tags the release and publishes a GitHub Release. `.github/workflows/release.yml` then publishes to npm through trusted publishing (OIDC), with provenance. Never edit `version`, `CHANGELOG.md`, or `.release-please-manifest.json` by hand.

### One-time setup (maintainer)

1. **First publish (0.1.0):** npm trusted publishing needs an existing package. Run `npm login` as a member of the `boyboni` scope, check out tag `v0.1.0`, and run `pnpm publish --access public`. `prepublishOnly` runs every check first.
2. **Trusted publisher:** on npmjs.com, open the package → Settings → Trusted publishing → GitHub Actions. Enter repository `boypanjaitan16/firestore-query` and workflow `release.yml`. Then set publishing access to require two-factor authentication and disallow tokens.
3. **Release PR token:** add a repository secret `RELEASE_PLEASE_TOKEN`, a fine-grained personal access token for this repository with Contents and Pull requests read and write, so the Release PR runs CI.

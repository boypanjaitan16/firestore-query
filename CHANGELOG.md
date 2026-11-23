# Changelog

## 0.1.0 (2026-11-23)

### Features

- Initial release, extracted from the portfolio monorepo where the admin app proved the API ([boypanjaitan16/portfolio#20](https://github.com/boypanjaitan16/portfolio/pull/20), [#22](https://github.com/boypanjaitan16/portfolio/pull/22), [#23](https://github.com/boypanjaitan16/portfolio/pull/23)).
- Typed query keys (`collectionKeys`, `collectionGroupKeys`, `docKey`).
- Realtime queries whose `onSnapshot` listener follows the query cache.
- One-shot document, query, aggregate, and cursor-paginated reads, with suspense-ready options factories.
- Write hooks that invalidate the written document, its collection, and its collection group; `removeFirestoreQueries` for sign-out.
- `defineConverter` that forwards `serverTimestamps: "estimate"`, plus timestamp helpers.

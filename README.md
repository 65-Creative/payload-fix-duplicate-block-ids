# Fix: Duplicate Block IDs in Payload CMS v3 (PostgreSQL / Drizzle)

A drop-in `beforeChange` hook that fixes the `"Value must be unique"` / PostgreSQL error **23505** when saving localized block content in Payload CMS v3.

## The Problem

When using **Payload CMS v3** with the **PostgreSQL/Drizzle adapter** and **localized block fields**, saving content that was copied between locales (e.g. DE -> EN) throws:

```
"Wert muss einzigartig sein"   (German UI)
"Value must be unique"          (English UI)

PostgreSQL error 23505: duplicate key value violates unique constraint
  Key (id)=(abc123) already exists.
  Table: pages_blocks_content
```

![Example of the "Das folgende Feld ist nicht korrekt: id" error in Payload CMS admin UI](./example-id-error.png)

This affects any block table: `pages_blocks_content`, `pages_blocks_*_features`, `posts_blocks_*`, etc.

## Root Cause

Three factors combine to create this bug:

### 1. Single-column Primary Key

Block tables in Drizzle use a single `id` (varchar) column as the PRIMARY KEY — **not** a composite key with `_locale`. This means every block row across all locales must have a globally unique ID.

### 2. Payload's `mergeLocaleActions` runs AFTER hooks

When you save a document, Payload's internal `mergeLocaleActions` merges the existing data from **other locales** (from `docWithLocales`) into the write operation. This merge happens **after** all collection-level `beforeChange` hooks have run. If you copied content from DE to EN, both locales now carry the same block IDs — and your hooks never get a chance to fix the merged data.

### 3. Pre-existing duplicates

If duplicate IDs were already written to the database before any fix was in place, they resurface every time the document is saved (via `docWithLocales`).

## The Solution

A two-layer `beforeChange` hook:

| Layer | What it does | Why it's needed |
|-------|-------------|-----------------|
| **1. Hook level** | Regenerates ALL block/array `id` fields in the incoming data with fresh UUIDs | Prevents the current locale's data from clashing |
| **2. Adapter level** | Monkey-patches the Drizzle adapter's `insert()` to deduplicate IDs within each INSERT batch | Catches duplicates introduced by `mergeLocaleActions` and pre-existing DB duplicates |

Neither layer alone is sufficient. Layer 1 can't reach other locales' data (it's merged later). Layer 2 alone would miss duplicates across separate INSERT calls.

## Quick Start

### 1. Copy the hook

Copy [`deduplicateBlockIds.ts`](./deduplicateBlockIds.ts) into your project (e.g. `src/hooks/`).

### 2. Register on your collections

Add the hook to every collection that has **localized `blocks` or `array` fields**:

```ts
import { deduplicateBlockIds } from '@/hooks/deduplicateBlockIds'

export const Pages: CollectionConfig = {
  slug: 'pages',
  hooks: {
    beforeChange: [deduplicateBlockIds],
  },
  fields: [
    {
      name: 'layout',
      type: 'blocks',
      localized: true,  // <-- This is what triggers the bug
      blocks: [ /* ... */ ],
    },
  ],
}
```

See [`example-collection.ts`](./example-collection.ts) for a full minimal example.

### 3. Done

The hook is idempotent and safe to register on collections without blocks — it simply won't find any IDs to replace.

## Technical Details

### Why `beforeChange` and not `beforeValidate`?

`beforeValidate` runs before Payload processes block data, so the block structure may not be fully resolved yet. `beforeChange` runs after validation but before the database write, giving us the final data shape with all blocks properly structured.

### Why monkey-patch the adapter?

Payload's `mergeLocaleActions` is internal and runs after all hooks. There is no official hook point between locale merging and the database INSERT. The adapter patch is the only reliable way to catch duplicates introduced at that stage.

### Is the adapter patch safe?

- It only runs once (guarded by `_insertPatched` flag)
- It only modifies rows that have duplicate string `id` fields within the same INSERT batch
- It uses `crypto.randomUUID()` for cryptographically random replacements
- It logs every replacement for debugging visibility

### Performance

The recursive ID regeneration and batch deduplication add negligible overhead. UUID generation is fast, and the Set-based duplicate check is O(n) per INSERT batch.

## Affected Versions

- **Payload CMS**: v3.x (any version using `@payloadcms/drizzle` with PostgreSQL)
- **Adapter**: `@payloadcms/db-postgres` / `@payloadcms/drizzle`
- **Condition**: Localized `blocks` or `array` fields (`localized: true`)

## How to Reproduce

1. Create a Payload v3 project with PostgreSQL
2. Add a collection with a `blocks` field set to `localized: true`
3. Create a document and add blocks in locale **DE**
4. Switch to locale **EN** and copy the same block content
5. Save -> **Error 23505: duplicate key value violates unique constraint**

## Files

| File | Description |
|------|-------------|
| [`deduplicateBlockIds.ts`](./deduplicateBlockIds.ts) | The hook — drop into your project |
| [`example-collection.ts`](./example-collection.ts) | Minimal collection config showing registration |
| [`example-id-error.png`](./example-id-error.png) | Screenshot of the error in Payload admin UI |

## Contributing

Found an edge case or improvement? PRs and issues welcome.

## License

MIT — use freely in your Payload CMS projects.

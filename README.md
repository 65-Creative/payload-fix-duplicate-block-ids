# Fix: Duplicate Block IDs in Payload CMS v3 (PostgreSQL / Drizzle)

A drop-in `beforeChange` hook that fixes the `"Value must be unique"` / PostgreSQL error **23505** when saving localized block content in Payload CMS v3.

## The Problem

When using **Payload CMS v3** with the **PostgreSQL/Drizzle adapter** and **localized block fields**, saving content throws:

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

Four factors combine to create this bug:

### 1. Single-column Primary Key

Block tables in Drizzle use a single `id` (varchar) column as the PRIMARY KEY — **not** a composite key with `_locale`. This means every block row across all locales and all documents must have a globally unique ID.

### 2. Payload's `mergeLocaleActions` runs AFTER hooks

When you save a document, Payload's internal `mergeLocaleActions` merges the existing data from **other locales** (from `docWithLocales`) into the write operation. This merge happens **after** all collection-level `beforeChange` hooks have run. If you copied content from DE to EN, both locales now carry the same block IDs — and your hooks never get a chance to fix the merged data.

### 3. Cross-document collisions

Block IDs copied between different documents (e.g. copy-pasting blocks from one page to another) collide with existing rows in the same block table. Since the PK is global across all documents, a block ID from page A will clash when inserted for page B.

### 4. Autosave interference

If you regenerate IDs on every save (including autosave/draft), Payload's admin UI treats the blocks as new items (because their IDs changed). This causes **fields to be duplicated hundreds of times** during editing, making the document impossible to save. The fix must distinguish between publish and autosave.

## The Solution

A two-layer `beforeChange` hook with **publish-only** hook-level regeneration:

| Layer | When it runs | What it does | Why it's needed |
|-------|-------------|--------------|-----------------|
| **1. Hook level** | **Publish only** (`_status === 'published'`) | Regenerates ALL block/array `id` fields in the incoming data with fresh UUIDs | Prevents the current locale's data from clashing. Only on publish to avoid duplicating fields during editing. |
| **2. Adapter level** | **Always** (all saves including drafts) | Monkey-patches the Drizzle adapter's `insert()` to regenerate ALL string IDs at INSERT time | Catches IDs from other locales injected by `mergeLocaleActions` and cross-document collisions. Safe for drafts because it operates on flattened DB rows, not the document structure. |

### Why both layers?

- **Layer 1 alone** can't reach other locales' data (it's merged later by Payload internals).
- **Layer 2 alone** works for preventing DB errors, but Layer 1 provides cleaner data at the document level on publish.
- **Layer 2 on drafts** is safe because it modifies the flattened database rows, not the document data structure that the admin UI reads back. Changing IDs at the DB row level does not cause field duplication.

### Why publish-only for Layer 1?

Running Layer 1 on every autosave (default: every 1.5 seconds) causes Payload to think existing blocks are new items (their IDs changed). This results in:
- Array/block items being duplicated hundreds of times
- Empty required fields blocking saves
- The document becoming impossible to edit

By limiting Layer 1 to publish (`data._status === 'published'`), editing works normally while publish is still protected.

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
  // Drafts should be enabled for the publish-only check to work
  versions: {
    drafts: {
      autosave: {
        interval: 1500,
      },
    },
  },
}
```

See [`example-collection.ts`](./example-collection.ts) for a full minimal example.

### 3. Done

The hook is idempotent and safe to register on collections without blocks — it simply won't find any IDs to replace.

## Important Notes

### Collections without drafts

If your collection does **not** use `versions.drafts`, the `data._status` field won't exist, so Layer 1 (hook-level) will never trigger. Layer 2 (adapter-level) still runs on every save and prevents duplicate ID errors. This is safe and sufficient.

### Lexical editor circular references

The `regenerateAllIds` function uses a `WeakSet` to track visited objects, preventing infinite loops from circular references in Lexical rich text editor data.

### Global adapter patch

Layer 2 patches `adapter.insert` globally — it affects ALL collections, not just the one the hook is registered on. This is intentional: the `_insertPatched_v5` flag ensures the patch is applied only once, and it only modifies rows with string `id` fields (block/array tables). Main document tables use numeric IDs and are unaffected.

The `onConflictDoUpdate` check in the single-row path prevents the patch from interfering with upsert operations.

## Technical Details

### Why `beforeChange` and not `beforeValidate`?

`beforeValidate` runs before Payload processes block data, so the block structure may not be fully resolved yet. `beforeChange` runs after validation but before the database write, giving us the final data shape.

### Why monkey-patch the adapter?

Payload's `mergeLocaleActions` is internal and runs after all hooks. There is no official hook point between locale merging and the database INSERT. The adapter patch is the only reliable way to catch duplicates introduced at that stage.

### The Drizzle upsertRow flow

Understanding the full update pipeline is key:

1. `beforeChange` hooks run (only current locale data available)
2. Payload's `mergeLocaleActions` merges other locales' blocks
3. `transformForWrite` converts document to DB rows
4. `upsertRow` **deletes** existing blocks by `_parentID`
5. `upsertRow` **re-inserts** all blocks for all locales via `adapter.insert()`

Step 5 is where our adapter patch intercepts — the last possible moment before the INSERT hits PostgreSQL.

### Performance

- UUID generation via `crypto.randomUUID()` is fast (~5μs per call)
- The `WeakSet` for circular reference detection adds negligible overhead
- The adapter patch adds one conditional check per INSERT call

## Affected Versions

- **Payload CMS**: v3.x (any version using `@payloadcms/drizzle` with PostgreSQL)
- **Adapter**: `@payloadcms/db-postgres` / `@payloadcms/drizzle`
- **Condition**: Localized `blocks` or `array` fields (`localized: true`)

## How to Reproduce

1. Create a Payload v3 project with PostgreSQL
2. Add a collection with a `blocks` field set to `localized: true`
3. Enable `versions.drafts` with autosave
4. Create a document and add blocks in locale **DE**
5. Switch to locale **EN** and copy the same block content
6. Publish -> **Error 23505: duplicate key value violates unique constraint**

Alternative reproduction: copy blocks from one page to another (cross-document collision).

## Version History

| Version | Change |
|---------|--------|
| v5 (current) | Publish-only Layer 1 + always-active Layer 2 with full ID regeneration. Fixes field duplication during editing. |
| v4 | Always-active Layer 1 + Layer 2 with full ID regeneration. Fixed cross-document collisions but caused field duplication during autosave. |
| v3 | Targeted dedup (only fix actual duplicates). Failed on cross-document collisions. |
| v2 | Regenerate all IDs + batch dedup in adapter. Worked but didn't catch locale merge IDs. |
| v1 | Simple intra-document dedup. Insufficient for cross-locale and cross-document cases. |

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

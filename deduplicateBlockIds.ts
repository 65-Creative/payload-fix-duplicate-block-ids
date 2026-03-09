import type { CollectionBeforeChangeHook } from 'payload'
import { randomUUID } from 'crypto'

/**
 * Recursively walks all nested objects and arrays, replacing every string `id`
 * field with a fresh UUID v4. This covers blocks, inline arrays, and any
 * nested structure Payload CMS generates for Drizzle/PostgreSQL.
 *
 * Why replace ALL IDs (not just duplicates)?
 * Because we can't know which IDs already exist in other locales' rows —
 * Payload merges those AFTER our hook runs. Fresh UUIDs are always safe.
 */
function regenerateAllIds(data: unknown, count = { replaced: 0 }): void {
  if (Array.isArray(data)) {
    for (const item of data) {
      regenerateAllIds(item, count)
    }
    return
  }

  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>
    if (typeof obj.id === 'string') {
      obj.id = randomUUID()
      count.replaced++
    }
    for (const value of Object.values(obj)) {
      if (value && typeof value === 'object') {
        regenerateAllIds(value, count)
      }
    }
  }
}

/**
 * Fix: Duplicate Block IDs in Payload CMS v3 (PostgreSQL / Drizzle)
 *
 * Prevents "Wert muss einzigartig sein" / "Value must be unique" /
 * PostgreSQL error 23505 on block `id` columns.
 *
 * ## Why two layers?
 *
 * **Layer 1 — Hook level (incoming data):**
 *   Regenerates every block/array `id` in the data the editor just saved.
 *   This prevents the CURRENT locale's data from clashing.
 *
 * **Layer 2 — Adapter level (INSERT batch deduplication):**
 *   Payload's internal `mergeLocaleActions` merges OTHER locales' existing data
 *   from `docWithLocales` AFTER all collection-level hooks have run.
 *   Those merged rows can carry IDs identical to the ones we just generated
 *   (or to each other, if duplicates were already in the DB). The adapter
 *   patch catches these at the last possible moment — right before INSERT.
 *
 * ## Usage
 *
 *   import { deduplicateBlockIds } from './deduplicateBlockIds'
 *
 *   const MyCollection: CollectionConfig = {
 *     slug: 'pages',
 *     hooks: {
 *       beforeChange: [deduplicateBlockIds],
 *     },
 *     fields: [ ... ],
 *   }
 *
 * Register this hook on EVERY collection that has localized `blocks` or
 * `array` fields. The hook is idempotent and safe to run on collections
 * that don't have blocks (it simply won't find any IDs to replace).
 */
export const deduplicateBlockIds: CollectionBeforeChangeHook = async ({
  data,
  req,
  operation,
  originalDoc,
  collection,
}) => {
  if (!data) return data

  const currentLocale = req.locale
  const count = { replaced: 0 }

  // ── Layer 1: Regenerate all block/array IDs in the incoming locale data ──
  regenerateAllIds(data, count)

  if (count.replaced > 0) {
    req.payload.logger.info(
      `[deduplicateBlockIds] ${collection.slug}/${originalDoc?.id ?? 'new'} ` +
        `locale=${currentLocale} op=${operation}: ` +
        `regenerated ${count.replaced} block/array IDs`,
    )
  }

  // ── Layer 2: Monkey-patch adapter insert to deduplicate IDs in batches ──
  const adapter = req.payload.db as any
  if (!adapter._insertPatched) {
    const originalInsert = adapter.insert.bind(adapter)

    adapter.insert = async (args: any) => {
      if (Array.isArray(args.values) && args.values.length > 1) {
        const seen = new Set<string>()
        for (const row of args.values) {
          if (typeof row?.id === 'string') {
            if (seen.has(row.id)) {
              const oldId = row.id
              row.id = randomUUID()
              req.payload.logger.info(
                `[deduplicateBlockIds] Fixed duplicate in INSERT batch ` +
                  `for ${args.tableName}: ${oldId} -> ${row.id}`,
              )
            } else {
              seen.add(row.id)
            }
          }
        }
      }
      return originalInsert(args)
    }

    adapter._insertPatched = true
  }

  return data
}

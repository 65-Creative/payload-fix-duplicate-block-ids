import type { CollectionBeforeChangeHook } from 'payload'
import { randomUUID } from 'crypto'

/**
 * Recursively walks block/array data and assigns a fresh UUID to every
 * string `id` field found. Uses a WeakSet to safely handle circular
 * references in Lexical editor data.
 */
function regenerateAllIds(data: unknown, count: { replaced: number }, visited: WeakSet<object>): void {
  if (Array.isArray(data)) {
    for (const item of data) {
      regenerateAllIds(item, count, visited)
    }
    return
  }

  if (data && typeof data === 'object') {
    if (visited.has(data as object)) return
    visited.add(data as object)

    const obj = data as Record<string, unknown>
    if (typeof obj.id === 'string') {
      obj.id = randomUUID()
      count.replaced++
    }
    for (const key in obj) {
      const value = obj[key]
      if (value && typeof value === 'object') {
        regenerateAllIds(value, count, visited)
      }
    }
  }
}

/**
 * Prevents "Value must be unique" errors on block/array IDs in Payload CMS.
 *
 * ONLY runs on PUBLISH — not during draft saves or autosave. This prevents
 * the hook from interfering with editing (changing IDs on every autosave
 * causes Payload to duplicate array/block items).
 *
 * Block tables use `id` (TEXT) as PRIMARY KEY — must be globally unique
 * across ALL documents and locales within the same table. Conflicts arise
 * from copy-paste between locales/pages and Payload's internal locale merge.
 *
 * Strategy:
 * 1. HOOK LEVEL (publish only): Regenerate ALL block/array string IDs
 *    with fresh UUIDs in the incoming locale data.
 *
 * 2. ADAPTER LEVEL (always active): Monkey-patch the Drizzle adapter's
 *    `insert` method to regenerate ALL string IDs at INSERT time.
 *    This catches IDs from other locales injected by Payload's locale
 *    merge AFTER the beforeChange hook.
 */
export const deduplicateBlockIds: CollectionBeforeChangeHook = async ({
  data,
  req,
  operation,
  originalDoc,
  collection,
}) => {
  if (!data) return data

  // Only regenerate IDs when publishing — skip draft saves and autosave
  // to prevent duplicating array/block items during editing
  const isPublish = data._status === 'published'

  if (isPublish) {
    const currentLocale = req.locale
    const count = { replaced: 0 }

    regenerateAllIds(data, count, new WeakSet())

    if (count.replaced > 0) {
      req.payload.logger.info(
        `[deduplicateBlockIds] ${collection.slug}/${originalDoc?.id ?? 'new'} locale=${currentLocale} op=${operation}: ` +
          `regenerated ${count.replaced} block/array IDs`,
      )
    }
  }

  // Layer 2: Monkey-patch adapter insert to regenerate ALL string IDs.
  // Active for ALL saves (including drafts) because the DB constraint
  // applies regardless of publish status. This layer is safe because it
  // operates on the flattened DB rows (not the document data structure),
  // so it cannot cause item duplication in the admin UI.
  const adapter = req.payload.db as any
  if (!adapter._insertPatched_v5) {
    const originalInsert = adapter.insert.bind(adapter)

    adapter.insert = async (args: any) => {
      const logger = adapter.payload?.logger

      // Regenerate ALL string IDs in every insert batch.
      // Main document tables use numeric IDs (unaffected).
      // Block/array tables use string IDs — these get fresh UUIDs to
      // prevent cross-document collisions from copied block content.
      if (Array.isArray(args.values)) {
        for (const row of args.values) {
          if (typeof row?.id === 'string') {
            row.id = randomUUID()
          }
        }
      } else if (args.values && typeof args.values === 'object' && typeof args.values.id === 'string' && !args.onConflictDoUpdate) {
        args.values.id = randomUUID()
      }

      try {
        return await originalInsert(args)
      } catch (error: any) {
        if (error?.code === '23505' || error?.cause?.code === '23505') {
          const pgError = error?.cause ?? error
          try {
            logger?.error(
              `[deduplicateBlockIds] PG unique violation! ` +
                `table=${args.tableName} constraint=${pgError.constraint} ` +
                `detail=${pgError.detail} ` +
                `batchSize=${Array.isArray(args.values) ? args.values.length : 1}`,
            )
          } catch {
            // Logging failure must not hide the original error
          }
        }
        throw error
      }
    }
    adapter._insertPatched_v5 = true
  }

  return data
}

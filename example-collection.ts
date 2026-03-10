/**
 * Example: Payload CMS v3 collection with the deduplicateBlockIds hook.
 *
 * This is a minimal, self-contained example. Copy `deduplicateBlockIds.ts`
 * into your project and register it exactly like this.
 *
 * IMPORTANT: The hook requires `versions.drafts` to be enabled because it
 * uses `data._status === 'published'` to distinguish publish from autosave.
 * If your collection does not use drafts, the hook's Layer 1 will be skipped
 * (Layer 2 at the adapter level still protects against duplicate IDs).
 */
import type { CollectionConfig } from 'payload'
import { deduplicateBlockIds } from './deduplicateBlockIds'

export const Pages: CollectionConfig = {
  slug: 'pages',
  fields: [
    {
      name: 'title',
      type: 'text',
      localized: true,
      required: true,
    },
    {
      name: 'layout',
      type: 'blocks',
      // The bug only occurs when blocks are localized.
      // Each locale gets its own rows in the block table, but they
      // share the same single-column `id` PRIMARY KEY in your database.
      localized: true,
      blocks: [
        {
          slug: 'content',
          fields: [
            {
              name: 'richText',
              type: 'richText',
            },
          ],
        },
        {
          slug: 'media',
          fields: [
            {
              name: 'image',
              type: 'upload',
              relationTo: 'media',
            },
          ],
        },
      ],
    },
  ],
  hooks: {
    // Register as the FIRST beforeChange hook so IDs are regenerated
    // before any other hooks that might read block data.
    beforeChange: [deduplicateBlockIds],
  },
  // Drafts must be enabled for the publish-only check to work.
  // Without drafts, Layer 1 (hook-level) won't trigger, but Layer 2
  // (adapter-level) still prevents duplicate ID errors.
  versions: {
    drafts: {
      autosave: {
        interval: 1500, // ms
      },
      schedulePublish: true,
    },
    maxPerDoc: 50,
  },
}

/**
 * Where the searchable select used to live.
 *
 * The control moved to `shared/components/ui/searchable-select.tsx` when the
 * settings registry's provider and model rows needed it: it is the app's one
 * searchable single-select and `ui/` is the primitive layer, so the settings
 * rows should not have to reach into a hosting-specific directory for a
 * general control.
 *
 * This file is a re-export rather than a deletion so the three call sites that
 * predate the move (`hosting-select`, `model-select`, the canvas's create-file
 * dialog), plus the story beside it, did not churn in the commit that moved
 * it. New code imports from `@shared/components/ui`.
 */

export {
	SearchableSelect,
	filterSearchableOptions,
	fold,
	resolveEnter,
} from "@shared/components/ui/searchable-select";
export type {
	SearchableOption,
	SearchableSelectProps,
} from "@shared/components/ui/searchable-select";

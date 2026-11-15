/*
 * WHICH TOOL CALLS ARE DETACHED MUSIC JOBS - and nothing else.
 *
 * WHY A MODULE OF ITS OWN. Two very different consumers need these three
 * facts: the generating card's model (`music-generating-model.ts`, which pulls
 * in React context, the Jobs panel's run-details models and the desktop API
 * types), and the transcript's fold model (`turn-collapse-model.ts`, which keeps
 * a music call that registered a job out of the collapsed "N actions" group).
 * The fold model is bundled into the condense parity pin
 * (`scripts/fixtures/condense.parity.json`), whose `desktop.modelSources` is
 * esbuild's full input graph; importing the predicates from the card model
 * dragged that whole React/run-details graph into the pin and into
 * `PARITY_MODEL_SOURCES` (R16-1, CI A27).
 *
 * CONSTRAINT: keep this file DEPENDENCY-FREE (no imports at all). Every import
 * added here becomes a parity model source and must be mirrored in
 * `scripts/ci-scope.mjs` `PARITY_MODEL_SOURCES`, or A27 fails.
 */

export const MUSIC_GEN_TOOL_NAMES: ReadonlySet<string> = new Set([
	"generate_music",
	"modify_music",
]);

export const isMusicGenTool = (toolName: string): boolean =>
	MUSIC_GEN_TOOL_NAMES.has(toolName);

const object = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);

/** The detached job a music call registered, or null when it registered none. */
export function musicJobIdOf(details: unknown): string | null {
	if (!object(details) || details.material !== "music") return null;
	return typeof details.job_id === "string" && details.job_id.length > 0
		? details.job_id
		: null;
}

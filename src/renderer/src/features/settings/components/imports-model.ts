/** Pure selection/search policy for the import screen, kept out of the view. */

import type { ImportSession, ImportSourceName } from "./imports-api";

/**
 * Source titles are foreign text, and at least one real omp title starts with a
 * private-use glyph (U+F0016) that renders as tofu in this app's fonts. Strip
 * private-use and control characters at the display boundary; the source id
 * remains the fallback and the stored title is untouched.
 */
export const cleanSessionTitle = (title: string): string =>
	title
		.replace(/[\p{Co}\p{Cc}]/gu, " ")
		.replace(/\s+/g, " ")
		.trim();

export const filterSessions = (
	sessions: ImportSession[],
	query: string,
): ImportSession[] => {
	const needle = query.trim().toLocaleLowerCase();
	if (!needle) return sessions;
	return sessions.filter((session) =>
		`${session.title} ${session.cwd} ${session.sourceId}`
			.toLocaleLowerCase()
			.includes(needle),
	);
};

/**
 * The identity a preview was built for. Sorted so a Set's insertion order can
 * never make an unchanged selection look stale, and source-qualified so two
 * harnesses cannot collide on an id.
 */
export const selectionSignature = (
	source: ImportSourceName | null,
	selected: Set<string>,
): string => `${source ?? ""}\u0000${[...selected].sort().join("\u0000")}`;

import type { FilesSort } from "../../canonical/session-files";
import type { FileKindGroup, FileRow } from "./file-rows";

export type FinderPreferences = {
	sort: FilesSort;
	order: "asc" | "desc";
	group: boolean;
	workingOpen: boolean;
	closedSections: string[];
	kinds: FileKindGroup[];
};
export const DEFAULT_FINDER: FinderPreferences = {
	sort: "recent",
	order: "asc",
	group: true,
	workingOpen: false,
	closedSections: [],
	kinds: [],
};
const SORTS = ["recent", "name", "kind", "modified", "created", "size"];
const KINDS = [
	"images",
	"video",
	"audio",
	"documents",
	"spreadsheets",
	"presentations",
	"code",
	"archives",
	"other",
];

/** A corrupt/downgraded profile must not turn a menu value into an API argument. */
export function sanitizeFinderPreferences(value: unknown): FinderPreferences {
	const data = (
		value && typeof value === "object" ? value : {}
	) as Partial<FinderPreferences>;
	return {
		sort: SORTS.includes(data.sort ?? "")
			? (data.sort as FilesSort)
			: DEFAULT_FINDER.sort,
		order: data.order === "desc" ? "desc" : "asc",
		group: typeof data.group === "boolean" ? data.group : true,
		workingOpen: data.workingOpen === true,
		closedSections: Array.isArray(data.closedSections)
			? [
					...new Set(
						data.closedSections.filter((id) =>
							[
								"Highlights",
								"Images",
								"Videos",
								"Sounds",
								"Documents",
								"Spreadsheets",
								"Other",
							].includes(id),
						),
					),
				]
			: [],
		kinds: Array.isArray(data.kinds)
			? [...new Set(data.kinds.filter((kind) => KINDS.includes(kind)))]
			: [],
	};
}

export type FinderItem = {
	row: FileRow;
	highlighted: boolean;
	why: string;
	created: number | null;
	modified: number | null;
	mentioned: number;
};
export type FinderSection = {
	id: string;
	label: string;
	items: FinderItem[];
	open: boolean;
	highlights: boolean;
};
export type FinderBand = {
	top: number;
	height: number;
	kind: "header" | "compact" | "highlight" | "tiles" | "video" | "audio";
	section: FinderSection;
	items: FinderItem[];
	cols: number;
};
export type FinderLayout = {
	bands: FinderBand[];
	height: number;
	columns: number;
	positions: Map<string, { band: number; column: number }>;
};

/** Stable missing-last sorts: reversing direction must never float unknown stats. */
export function sortFinder(
	items: FinderItem[],
	prefs: FinderPreferences,
): FinderItem[] {
	const metric = (item: FinderItem): string | number | null => {
		switch (prefs.sort) {
			case "name":
				return item.row.name;
			case "kind":
				return `${item.row.kind}\0${item.row.name}`;
			case "modified":
				return item.modified;
			case "created":
				return item.created;
			case "size":
				return item.row.document.sizeBytes ?? null;
			default:
				return item.mentioned;
		}
	};
	return [...items].sort((a, b) => {
		const av = metric(a);
		const bv = metric(b);
		if (av === null || bv === null) return av === bv ? 0 : av === null ? 1 : -1;
		const compared =
			typeof av === "string" && typeof bv === "string"
				? av.localeCompare(bv, undefined, { numeric: true })
				: Number(av) - Number(bv);
		return (
			(prefs.order === "asc" ? compared : -compared) ||
			a.mentioned - b.mentioned
		);
	});
}

const sectionKind = (item: FinderItem): string => {
	switch (item.row.kind) {
		case "images":
			return "Images";
		case "video":
			return "Videos";
		case "audio":
			return "Sounds";
		case "spreadsheets":
			return "Spreadsheets";
		case "documents":
		case "presentations":
		case "code":
			return "Documents";
		default:
			return "Other";
	}
};

export function finderSections(
	items: FinderItem[],
	prefs: FinderPreferences,
	narrowing: boolean,
	closed: Set<string>,
): FinderSection[] {
	const highlights = items.filter((item) => item.highlighted);
	const working = items.filter((item) => !item.highlighted);
	const sections: FinderSection[] = [];
	if (highlights.length)
		sections.push({
			id: "Highlights",
			label: "Highlights",
			items: highlights,
			open: narrowing || !closed.has("Highlights"),
			highlights: true,
		});
	if (highlights.length && working.length) {
		sections.push({
			id: "Working files",
			label: "Working files",
			items: [],
			open: prefs.workingOpen || narrowing,
			highlights: false,
		});
		if (!prefs.workingOpen && !narrowing) return sections;
	}
	if (!prefs.group) {
		if (working.length)
			sections.push({
				id: "Files",
				label: "Files",
				items: working,
				open: true,
				highlights: false,
			});
	} else
		for (const kind of [
			"Images",
			"Videos",
			"Sounds",
			"Documents",
			"Spreadsheets",
			"Other",
		]) {
			const grouped = working.filter((item) => sectionKind(item) === kind);
			if (grouped.length)
				sections.push({
					id: kind,
					label: kind,
					items: grouped,
					open: narrowing || !closed.has(kind),
					highlights: false,
				});
		}
	return sections;
}

/**
 * Mixed layout with no per-item measuring: decoding changes pixels, not height.
 * One width observation owns all geometry. Offscreen items cost no DOM/reads;
 * the same model owns keyboard destinations, so focus cannot navigate a second
 * imagined grid. Plain list/button semantics, never a fake ARIA grid/listbox.
 */
export function layoutFinder(
	sections: FinderSection[],
	width: number,
	grouped: boolean,
): FinderLayout {
	const bands: FinderBand[] = [];
	const positions = new Map<string, { band: number; column: number }>();
	const w = Math.max(136, width - 16);
	const cols = Math.max(1, Math.floor((w + 4) / 140));
	let top = 0;
	const push = (
		section: FinderSection,
		kind: FinderBand["kind"],
		height: number,
		items: FinderItem[],
		columns = 1,
	) => {
		items.forEach((item, column) =>
			positions.set(item.row.document.id, { band: bands.length, column }),
		);
		bands.push({ section, kind, height, top, items, cols: columns });
		top += height;
	};
	for (const section of sections) {
		push(section, "header", 32, []);
		if (!section.open) continue;
		if (section.highlights)
			for (const item of section.items)
				push(section, "highlight", item.why ? 68 : 44, [item]);
		else if (grouped && section.id === "Images") {
			const tileW = (w - 4 * (cols - 1)) / cols;
			const height = Math.round(((tileW - 8) * 3) / 4) + 32;
			for (let i = 0; i < section.items.length; i += cols)
				push(section, "tiles", height, section.items.slice(i, i + cols), cols);
		} else if (grouped && section.id === "Videos")
			for (const item of section.items)
				push(
					section,
					"video",
					Math.min(Math.round(((w - 8) * 9) / 16), 280) + 32,
					[item],
				);
		else if (grouped && section.id === "Sounds")
			/*
			 * One fixed row per sound, not a per-item measurement: a sound's compact
			 * player is a transport row (control + waveform + clock), and its height
			 * does not depend on the clip's length or aspect the way a video's does.
			 * The 44 px content floor is the brief's touch target; the extra 4 px is
			 * the row's own breathing room, matching the compact row's 36 -> band 32
			 * arithmetic above.
			 */
			for (const item of section.items) push(section, "audio", 80, [item]);
		else for (const item of section.items) push(section, "compact", 36, [item]);
	}
	return { bands, height: top, columns: cols, positions };
}

/** Binary search into monotone row offsets, with one pinned focused item. */
export function finderWindow(
	layout: FinderLayout,
	scrollTop: number,
	height: number,
	focused: string | null,
): number[] {
	const overscan = Math.max(600, height * 0.75);
	let lo = 0;
	let hi = layout.bands.length;
	while (lo < hi) {
		const mid = (lo + hi) >>> 1;
		const band = layout.bands[mid];
		if (band.top + band.height < scrollTop - overscan) lo = mid + 1;
		else hi = mid;
	}
	const indices = new Set<number>();
	for (
		let i = lo;
		i < layout.bands.length &&
		layout.bands[i].top <= scrollTop + height + overscan;
		i++
	)
		indices.add(i);
	const pin = focused ? layout.positions.get(focused) : null;
	if (pin) indices.add(pin.band);
	return [...indices].sort((a, b) => a - b);
}

export function finderNeighbor(
	layout: FinderLayout,
	id: string,
	key: string,
	viewport: number,
): string | null {
	const position = layout.positions.get(id);
	if (!position) return null;
	const band = layout.bands[position.band];
	const sectionBands = layout.bands.filter(
		(b) => b.section.id === band.section.id && b.items.length,
	);
	if (key === "Home") return sectionBands[0]?.items[0]?.row.document.id ?? null;
	if (key === "End")
		return sectionBands.at(-1)?.items.at(-1)?.row.document.id ?? null;
	if (key === "ArrowLeft" || key === "ArrowRight")
		return (
			band.items[position.column + (key === "ArrowLeft" ? -1 : 1)]?.row.document
				.id ?? null
		);
	const direction = key === "ArrowUp" || key === "PageUp" ? -1 : 1;
	const targetTop =
		band.top + (key.startsWith("Page") ? viewport * direction : direction);
	let next = position.band + direction;
	for (; next >= 0 && next < layout.bands.length; next += direction) {
		const candidate = layout.bands[next];
		if (!candidate.items.length) continue;
		if (
			key.startsWith("Page") &&
			(direction > 0 ? candidate.top < targetTop : candidate.top > targetTop)
		)
			continue;
		return candidate.items[
			Math.min(position.column, candidate.items.length - 1)
		].row.document.id;
	}
	if (key.startsWith("Page")) {
		// A page stride past the final band still has a keyboard destination.
		// Clamp to the boundary rather than stranding focus near either end.
		const bands = layout.bands.filter((candidate) => candidate.items.length);
		const boundary = direction < 0 ? bands[0] : bands.at(-1);
		return (
			boundary?.items[direction < 0 ? 0 : boundary.items.length - 1]?.row
				.document.id ?? null
		);
	}
	return null;
}

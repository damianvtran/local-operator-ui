/**
 * The appearance picker's arrow-navigation rule, as arithmetic on indices.
 *
 * ## Why this is a module rather than a closure inside the component
 *
 * The rule used to live in `moveFocus` as a table of flat offsets —
 * `ArrowDown: index + columns`, `ArrowUp: index - columns` — and that arithmetic
 * is wrong in exactly one place: the seam between the two grids. The Dark group
 * holds forty-one tiles, so its last row is short (one tile at five columns, two
 * at three), and the Light group starts a NEW row rather than continuing the
 * Dark group's. Offsetting by a flat `columns` therefore steps off the short row
 * and lands up to four columns into the Light group's first row — measured in
 * the app, `ArrowDown` from `rosewood` reached `rosePineDawn` 685px away instead
 * of `localOperatorLight` directly beneath it, and `ArrowUp` from
 * `localOperatorLight` skipped `rosewood` entirely. Deterministic at both
 * column counts (UX round 2, U1).
 *
 * The defect survived a browser walk because the rule could only be exercised
 * by driving the app; nothing could ask it a question. Here it is a pure
 * function over indices, covered by `scripts/theme-grid-navigation.test.mjs`,
 * which asserts the boundary cases by name against the shipped registry. The
 * component keeps the part that genuinely needs a browser — reading the tiles
 * and the column counts out of the DOM — and delegates the decision.
 *
 * ## What the rule needs, and why indices alone cannot answer it
 *
 * "The tile visually beneath" is not a function of `index` and `columns`: the
 * Dark group's row sixteen and the Light group's row one are adjacent on screen
 * but not adjacent in the flat list's arithmetic, and no offset can know where
 * one grid stopped. The GROUP BOUNDARIES are the missing input, so the caller
 * passes them: one entry per group grid, in DOM order, each carrying its own
 * tile count and its own measured column count.
 *
 * The column count stays measured from the DOM — both counts, per group, from
 * each grid's own first row — rather than derived from `index % columns`. Under
 * `repeat(auto-fill, minmax(160px, 1fr))` the count is a property of the
 * rendered width, so a hardcoded or inferred number would be wrong at every
 * width but one. Measuring each group separately rather than measuring once and
 * reusing it is deliberate: the two grids are the same width today, but a single
 * count would silently misplace every Light tile's row if that ever stopped
 * being true, and the cost is one `getBoundingClientRect` per tile either way.
 *
 * ## The rule the eye expects
 *
 *   - `ArrowDown` / `ArrowUp` move to the tile in the next / previous visual
 *     ROW that is nearest the current column, clamped to that row's last tile
 *     when the row is shorter than the current column. A group's first tile
 *     begins a new row, so the Dark→Light crossing follows the picture: the
 *     tile below `rosewood` is the Light group's tile in `rosewood`'s column,
 *     and not four columns past it.
 *   - `ArrowLeft` / `ArrowRight` move one tile in DOM order, which is visual
 *     order inside a row and across the seam, and clamp at the ends rather than
 *     wrapping — a wrap at `End` is a jump the user did not ask for in a picker
 *     they are scanning by eye.
 *   - `Home` / `End` jump to the first and last tile of the whole set.
 *
 * Neither column nor group count is capped or assumed: three groups, one group
 * and a group whose first row is short all behave, because the rule walks the
 * row bands it is given instead of doing arithmetic on a column count.
 *
 * ## What this cannot decide
 *
 * Anything about pixels. It knows indices, rows and columns; the caller owns the
 * DOM, the measurement and the `.focus()` call. It also does not pick the tiles
 * up: a group that renders no tile contributes no row band, and an `index`
 * outside the union of the groups is returned unchanged rather than clamped into
 * a tile that is not the one the caller asked about.
 */

/** The keys the picker's grid answers. Modifiers and everything else are the page's. */
export const TILE_NAV_KEYS = [
	"ArrowLeft",
	"ArrowRight",
	"ArrowUp",
	"ArrowDown",
	"Home",
	"End",
] as const;

export type TileNavKey = (typeof TILE_NAV_KEYS)[number];

/** One group grid's measured shape, in DOM order. */
export interface TileGridGroup {
	/** Tiles in this group, in DOM order. */
	count: number;
	/**
	 * Tiles per row in THIS group, measured from the group's own first row
	 * rather than passed in once for the whole picker (see the note above).
	 */
	columns: number;
}

/** Whether the grid answers this key. Unknown keys are the page's to handle. */
export const isTileNavKey = (key: string): key is TileNavKey =>
	(TILE_NAV_KEYS as readonly string[]).includes(key);

/** One visual row: `count` tiles starting at flat index `start`. */
interface RowBand {
	start: number;
	count: number;
}

/**
 * Every visual row of the picker, in screen order, as flat index ranges.
 *
 * A group starts a new band whatever its tile count, because that is what the
 * DOM does: each group renders in its own grid element, so the first tile of the
 * Light group is on a new row even when the Dark group's last row is short. A
 * group with no tiles contributes no band, which is why an empty group cannot
 * make an index resolve to a row that is not on screen.
 */
const rowBands = (groups: readonly TileGridGroup[]): RowBand[] => {
	const bands: RowBand[] = [];
	let start = 0;
	for (const group of groups) {
		const count = Math.max(0, Math.floor(group.count));
		const columns = Math.max(1, Math.floor(group.columns));
		for (let offset = 0; offset < count; offset += columns) {
			bands.push({
				start: start + offset,
				count: Math.min(columns, count - offset),
			});
		}
		start += count;
	}
	return bands;
};

/**
 * The tile an arrow, Home or End moves focus to from `index`.
 *
 * Returns `index` when the press cannot move — a clamp at the first or last
 * tile, or an index or key this rule has no answer for — so the caller can
 * compare and skip a pointless `.focus()`.
 */
export const nextTileIndex = ({
	index,
	key,
	groups,
}: {
	index: number;
	key: string;
	groups: readonly TileGridGroup[];
}): number => {
	const bands = rowBands(groups);
	const total = bands.reduce((sum, band) => sum + band.count, 0);
	if (!Number.isInteger(index) || index < 0 || index >= total) return index;

	switch (key) {
		case "Home":
			return 0;
		case "End":
			return total - 1;
		case "ArrowLeft":
			return Math.max(0, index - 1);
		case "ArrowRight":
			return Math.min(total - 1, index + 1);
		case "ArrowUp":
		case "ArrowDown": {
			const row = bands.findIndex(
				(band) => index >= band.start && index < band.start + band.count,
			);
			const target = bands[row + (key === "ArrowDown" ? 1 : -1)];
			if (!target) return index;
			/*
			 * Nearest tile in the same column, which is the same thing as clamping
			 * to the row's last tile: the candidates are 0..count-1, so a column
			 * past the end has no nearer tile than that end.
			 */
			const column = index - bands[row].start;
			return target.start + Math.min(column, target.count - 1);
		}
		default:
			return index;
	}
};

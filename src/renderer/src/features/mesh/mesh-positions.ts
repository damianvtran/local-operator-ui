/**
 * WHERE a node sits, and why it stays there.
 *
 * TWO SEPARATE JOBS, kept in one file because they are one decision read from two
 * ends:
 *
 *   1. **Slots are assigned ONCE and retained.** `assignSlots` is a pure function
 *      over the previous assignment and the ids now present. A node already in the
 *      map keeps its slot; a new node takes the lowest free one; a node that left
 *      frees its slot and NOTHING ELSE MOVES. The plan's §2 rule and Grafana's
 *      `fixedX`/`fixedY` lesson: a 30 s poll that re-solves the layout is a view
 *      whose nodes settle under the pointer, and "click targets that move" is the
 *      misclick failure mode the research names.
 *
 *      This is deliberately NOT a stable label sort. A sort is stable only while
 *      the SET is: inserting a device whose name sorts second moves every node
 *      below it, which is exactly the reshuffle the rule exists to prevent. Label
 *      order is where a column STARTS (the first assignment, when there is no
 *      history), not where it stays.
 *
 *   2. **Geometry, in world coordinates.** Two columns - networks left, devices
 *      right - each centred on the taller one, so one network beside five devices
 *      sits at the middle of its fan rather than at the top of it. The numbers are
 *      CSS pixels and they are the WORLD's: the viewport's own scale is the
 *      canvas's business, not the layout's.
 *
 * WHY NO FORCE SIMULATION AND NO GRAPH LIBRARY (`package.json` has neither, and
 * `pnpm bundle-size`/`startup-closure` are gates): the graph is two columns and a
 * transform. Grafana ships layered as the default and calls force "too random";
 * the ceiling it names for layered layouts (~500 nodes) is two orders of magnitude
 * above `networks + devices` here, and the tab says so rather than degrading
 * silently if a topology ever reaches it.
 */

export type SlotMap = ReadonlyMap<string, number>;

/** A node in a column, reduced to what a slot decision needs. */
export type SlotCandidate = { key: string; label: string };

/** Stable label order, then id - the order a column starts in. */
const byLabel = (a: SlotCandidate, b: SlotCandidate) =>
	a.label.localeCompare(b.label) || a.key.localeCompare(b.key);

/**
 * The next slot map: previous assignments kept, new nodes placed, gaps left by
 * departed nodes reused.
 *
 * The result contains exactly `candidates`' keys, so a caller cannot render a node
 * the topology no longer has. Reuse of a gap is deliberate rather than tidy: slots
 * are indices, and leaving holes would grow the world's height without bound as
 * devices come and go, while reusing one moves no existing node.
 */
export function assignSlots(
	previous: SlotMap,
	candidates: readonly SlotCandidate[],
): SlotMap {
	const next = new Map<string, number>();
	const taken = new Set<number>();
	for (const candidate of candidates) {
		const slot = previous.get(candidate.key);
		if (slot === undefined || taken.has(slot)) continue;
		next.set(candidate.key, slot);
		taken.add(slot);
	}
	let free = 0;
	for (const candidate of [...candidates].sort(byLabel)) {
		if (next.has(candidate.key)) continue;
		while (taken.has(free)) free += 1;
		next.set(candidate.key, free);
		taken.add(free);
	}
	return next;
}

/** The two columns of the bipartite layout, each with its own pinned slots. */
export type MeshSlots = { networks: SlotMap; devices: SlotMap };

export const EMPTY_SLOTS: MeshSlots = {
	networks: new Map<string, number>(),
	devices: new Map<string, number>(),
};

/** Geometry, in world CSS pixels. */
export const NODE_WIDTH = 200;
export const NODE_HEIGHT = 48;
export const ROW_GAP = 16;
/**
 * The room the edges fan in, and the reason a two-network mesh reads as two lines
 * rather than a smear: a cubic needs horizontal run to separate its control points.
 */
export const COLUMN_GAP = 200;
export const PAD = 24;

/** A node's box in world coordinates. */
export type NodeBox = { key: string; x: number; y: number };

export type ColumnGeometry = {
	boxes: Map<string, NodeBox>;
	/** The vertical extent of this column, for centring and for the world's size. */
	height: number;
};

/** The world's extent, from the two columns. */
export type MeshBounds = { width: number; height: number };

function column(slots: SlotMap, x: number): ColumnGeometry {
	const boxes = new Map<string, NodeBox>();
	for (const [key, slot] of slots) {
		// No padding here: the COLUMN does not own the world's margin. `meshGeometry`
		// places the column inside the world, which is what lets a short column be
		// centred against a tall one.
		boxes.set(key, { key, x, y: slot * (NODE_HEIGHT + ROW_GAP) });
	}
	/*
	 * The span the column's SLOTS occupy, not the count of nodes: a gap at slot 3
	 * still takes three rows of height, and compressing it away would move the
	 * nodes above it on the next poll - the one thing slots exist to prevent.
	 */
	const used = slots.size === 0 ? 0 : Math.max(...slots.values()) + 1;
	return {
		boxes,
		height: used === 0 ? 0 : used * NODE_HEIGHT + (used - 1) * ROW_GAP,
	};
}

export type MeshGeometry = {
	networks: Map<string, NodeBox>;
	devices: Map<string, NodeBox>;
	bounds: MeshBounds;
};

/**
 * The world's geometry for one slot assignment.
 *
 * A COLUMN IS CENTRED ON THE TALLER ONE, which is why both columns' heights are
 * computed before either is placed: with one network and three devices, the
 * network sits at the second device's row rather than at the top of the world.
 */
export function meshGeometry(slots: MeshSlots): MeshGeometry {
	const networkColumn = column(slots.networks, PAD);
	const deviceColumn = column(slots.devices, PAD + NODE_WIDTH + COLUMN_GAP);
	const span = Math.max(networkColumn.height, deviceColumn.height);
	const height = PAD * 2 + span;
	/*
	 * EACH COLUMN IS CENTRED ON THE TALLER ONE, and the offset is computed PER COLUMN:
	 * shifting both by one shared amount - which is what this did first, and what
	 * `mesh-tab.test.mjs` caught - leaves a one-network column at the TOP of a
	 * three-device fan, which is the arrangement this function exists to avoid.
	 */
	const centred = (boxes: Map<string, NodeBox>, columnHeight: number) => {
		const offset = PAD + (span - columnHeight) / 2;
		const shifted = new Map<string, NodeBox>();
		for (const [key, box] of boxes)
			shifted.set(key, { ...box, y: box.y + offset });
		return shifted;
	};
	return {
		networks: centred(networkColumn.boxes, networkColumn.height),
		devices: centred(deviceColumn.boxes, deviceColumn.height),
		bounds: {
			width: PAD * 2 + NODE_WIDTH * 2 + COLUMN_GAP,
			height,
		},
	};
}

/** The cubic from a network's right edge to a device's left edge. */
export function edgePath(from: NodeBox, to: NodeBox): string {
	const x1 = from.x + NODE_WIDTH;
	const y1 = from.y + NODE_HEIGHT / 2;
	const x2 = to.x;
	const y2 = to.y + NODE_HEIGHT / 2;
	const mid = (x1 + x2) / 2;
	return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
}

/** The zoom range the canvas clamps to. Named here so stories and tests share it. */
export const MIN_SCALE = 0.25;
export const MAX_SCALE = 3;

/**
 * The transform that fits `bounds` inside a viewport, with a margin.
 *
 * Used by "fit" (double-click on empty ground, and the initial view) and NOT by a
 * poll: a poll never changes the viewport transform, which is the classic
 * refetch-resets-zoom defect. Pure, so the fit can be asserted without pixels.
 */
export function fitTransform(
	bounds: MeshBounds,
	viewport: { width: number; height: number },
	scaleRange: { min: number; max: number } = { min: MIN_SCALE, max: MAX_SCALE },
): { k: number; tx: number; ty: number } {
	if (viewport.width <= 0 || viewport.height <= 0)
		return { k: 1, tx: 0, ty: 0 };
	const k = Math.min(
		scaleRange.max,
		Math.max(
			scaleRange.min,
			Math.min(
				viewport.width / Math.max(1, bounds.width),
				viewport.height / Math.max(1, bounds.height),
			) * 0.92,
		),
	);
	return {
		k,
		tx: (viewport.width - bounds.width * k) / 2,
		ty: (viewport.height - bounds.height * k) / 2,
	};
}

/**
 * The zoom-about-a-point solve: the world point under the pointer is invariant.
 *
 * The algebra is the whole content of "zoom about the cursor", and getting it
 * wrong is what makes a wheel-zoom feel like the canvas is sliding away: with the
 * world layer at `translate(t) scale(k)` and the pointer at `p`, the same world
 * point stays under the pointer when `t' = p - (p - t) * (k'/k)`.
 */
export function zoomAbout(
	transform: { k: number; tx: number; ty: number },
	point: { x: number; y: number },
	nextScale: number,
	range: { min: number; max: number } = { min: MIN_SCALE, max: MAX_SCALE },
): { k: number; tx: number; ty: number } {
	const k = Math.min(range.max, Math.max(range.min, nextScale));
	const ratio = k / transform.k;
	return {
		k,
		tx: point.x - (point.x - transform.tx) * ratio,
		ty: point.y - (point.y - transform.ty) * ratio,
	};
}

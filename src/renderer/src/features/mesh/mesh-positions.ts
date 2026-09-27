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
/**
 * A NETWORK LANE'S HEIGHT: one line of text, a count, and nothing else.
 *
 * Split from the device node's height in slice 2 rather than shared, because the
 * two nodes stopped being the same shape: a lane is a heading, while a device node
 * carries its conversations (a title, a stat line and a reserved chip band). The
 * lane is still CENTRED on the column beside it, so the two heights do not have to
 * match for the picture to hold - and sharing one number would have padded every
 * lane with 24 px of nothing.
 */
export const NETWORK_HEIGHT = 48;
/**
 * A DEVICE NODE'S HEIGHT, chip band included WHETHER OR NOT IT HOLDS ANYTHING.
 *
 * THE BAND IS RESERVED, and that is the plan's "a node must not breathe on a poll"
 * applied to the second axis: a node that grew when its first conversation appeared
 * would move every node below it in the column at that moment - the reshuffle this
 * module exists to prevent - and it would do it under the reader's pointer. 48 px is
 * slice 1's node; the extra 24 px is the band (`NODE_CHIP_BAND`).
 */
export const NODE_CHIP_BAND = 24;
export const DEVICE_HEIGHT = 72;
/**
 * The node height a caller means when it does not say, kept as the device's.
 *
 * Slice 1 had one height for both columns and its readers import it by this name;
 * leaving it as an alias rather than renaming every call site keeps the diff on the
 * geometry that actually changed.
 */
export const NODE_HEIGHT = DEVICE_HEIGHT;
export const ROW_GAP = 16;
/**
 * The room the edges fan in, and the reason a two-network mesh reads as two lines
 * rather than a smear: a cubic needs horizontal run to separate its control points.
 */
export const COLUMN_GAP = 200;
export const PAD = 24;

/** A node's box in world coordinates, with the height its own kind of node uses. */
export type NodeBox = { key: string; x: number; y: number; height: number };

export type ColumnGeometry = {
	boxes: Map<string, NodeBox>;
	/** The vertical extent of this column, for centring and for the world's size. */
	height: number;
};

/** The world's extent, from the two columns. */
export type MeshBounds = { width: number; height: number };

function column(slots: SlotMap, x: number, nodeHeight: number): ColumnGeometry {
	const boxes = new Map<string, NodeBox>();
	for (const [key, slot] of slots) {
		// No padding here: the COLUMN does not own the world's margin. `meshGeometry`
		// places the column inside the world, which is what lets a short column be
		// centred against a tall one.
		boxes.set(key, {
			key,
			x,
			y: slot * (nodeHeight + ROW_GAP),
			height: nodeHeight,
		});
	}
	/*
	 * The span the column's SLOTS occupy, not the count of nodes: a gap at slot 3
	 * still takes three rows of height, and compressing it away would move the
	 * nodes above it on the next poll - the one thing slots exist to prevent.
	 */
	const used = slots.size === 0 ? 0 : Math.max(...slots.values()) + 1;
	return {
		boxes,
		height: used === 0 ? 0 : used * nodeHeight + (used - 1) * ROW_GAP,
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
	const networkColumn = column(slots.networks, PAD, NETWORK_HEIGHT);
	const deviceColumn = column(
		slots.devices,
		PAD + NODE_WIDTH + COLUMN_GAP,
		DEVICE_HEIGHT,
	);
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
	// EACH END USES ITS OWN HEIGHT: a lane and a node are different shapes since
	// slice 2, so one shared midpoint would draw every edge slightly off the lane it
	// starts from - visible at two networks and invisible at one, which is the kind of
	// defect that ships.
	const y1 = from.y + from.height / 2;
	const x2 = to.x;
	const y2 = to.y + to.height / 2;
	const mid = (x1 + x2) / 2;
	return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
}

/** The zoom range the canvas clamps to. Named here so stories and tests share it. */
export const MIN_SCALE = 0.25;
export const MAX_SCALE = 3;

/**
 * The FIT never enlarges the world past its designed size (design round 1, D2).
 *
 * The fit used to scale a small graph up into whatever room the viewport had: the
 * two-device frame measured the node's fill band at 358px for a 200px world box, i.e.
 * 1.79x, which renders the label at ~23px beside the page's own 13px subtitle and pins
 * the ellipsis at 200 WORLD px - so `unreachable (no route t...` is cut mid-word inside
 * a box with 158px to spare. The designed size is the size the type was designed for,
 * so a small graph is centred in the viewport rather than blown up into it, and a LARGE
 * one still shrinks to fit (the `MIN_SCALE` side is unchanged). Zooming IN remains the
 * user's own gesture - `MAX_SCALE` above is untouched by this.
 */
export const MAX_FIT_SCALE = 1;

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
		MAX_FIT_SCALE,
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

/** The breathing room `keepNodeVisible` leaves between a node's edge and the box. */
export const KEEP_MARGIN_PX = 16;

/**
 * The MINIMUM translation that puts a node's box back inside a viewport.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT A RE-FIT (design review round 1, D1).
 * `fitTransform` runs once, behind `fitted`, on the invariant "a poll never changes the
 * transform" - and a PANEL OPENING is not a poll: it takes ~335 px of the canvas in one
 * step, leaving the transform pointing past the new right edge. Measured at 1024x768,
 * opening the panel clipped the node the reader had just clicked to **26 px of its 200**
 * (13%), with a second node clipped the same way: clicking a device to inspect it is
 * what hid it. Re-fitting instead would silently discard the reader's own pan and zoom
 * on every panel toggle, which is the defect the fit-once rule exists to prevent, so
 * the rule is a CLAMP rather than a fit: the transform keeps its scale and moves only
 * by the amount needed to bring the node back.
 *
 * Pure, and expressed in SCREEN coordinates, so the answer is checkable without pixels:
 * the node's world box under `translate(t) scale(k)` lands at `t + x*k`, and the clamp
 * solves each axis independently - right edge first, then left, so a node wider than the
 * box is left-aligned rather than oscillated between the two rules.
 */
export function keepNodeVisible(
	transform: { k: number; tx: number; ty: number },
	box: { x: number; y: number; height: number },
	viewport: { width: number; height: number },
	margin: number = KEEP_MARGIN_PX,
): { k: number; tx: number; ty: number } {
	const left = transform.tx + box.x * transform.k;
	const right = left + NODE_WIDTH * transform.k;
	const top = transform.ty + box.y * transform.k;
	const bottom = top + box.height * transform.k;
	let dx = 0;
	if (right > viewport.width - margin) dx = viewport.width - margin - right;
	if (left + dx < margin) dx = margin - left;
	let dy = 0;
	if (bottom > viewport.height - margin) dy = viewport.height - margin - bottom;
	if (top + dy < margin) dy = margin - top;
	if (dx === 0 && dy === 0) return transform;
	return { k: transform.k, tx: transform.tx + dx, ty: transform.ty + dy };
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

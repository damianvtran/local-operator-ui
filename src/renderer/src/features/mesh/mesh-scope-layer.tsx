/**
 * The canvas's boundaries: an enclosure drawn around a group of devices whose published
 * addresses support a claim, and NOTHING where they do not.
 *
 * `mesh-scope.ts` decides the tiers and owns the six refusals; this file draws them, and
 * it is deliberately the smallest half of the pair. What it draws:
 *
 *   - **`shared`** (a prefix this device also publishes): a SOLID enclosure in
 *     `--color-control` - a boundary whose removal loses information, because it is the
 *     only visual difference between a verified grouping and a probable one.
 *   - **`probable`** (two peers agree, this device knows nothing about it): a DASHED
 *     enclosure in the decorative `--color-hairline-strong` - NOT `hairline`, which this
 *     change rejected as too faint even for the GROUND (1.18:1 on the light brand
 *     palette): leaving the semantic tier on it drew the boundary with a weaker role
 *     than the decoration beside it (design review round 1, D3). The dash pattern and
 *     the label remain the channels that carry the tier; the ink is no longer fainter
 *     than the texture.
 *   - **`declared`** (the operator authored it): solid, with the declared WORD in the
 *     label. A declared boundary must not look like an inferred one, so the difference is
 *     carried twice: by the word and by the tier's own ink.
 *   - **`unknown` / nothing**: no element at all. A boundary is a claim; there is no
 *     empty state for one.
 *
 * THE LABEL NAMES THE TEST, not just the range: `10.88.0.x · same prefix` rather than
 * `10.88.0.x`. `10.88.0.0/24` is WireGuard's default and collides across unrelated
 * installs, so the word `prefix` is the one thing that keeps a collision from reading as
 * a shared LAN - and `x` rather than `/24` because the mask is a test applied here, not
 * something the wire published (`mesh-scope.ts`'s refusal 5).
 *
 * ACCESSIBILITY: the layer is `aria-hidden`, the same rule the edge layer follows. The
 * boundary is a canvas-level reading of addresses, and the addresses themselves are
 * listed in full in the device panel's Network addresses section - so a reader who cannot
 * see the enclosure is not left without the facts it was drawn from. What is NOT
 * available to them is the inference: that is stated here rather than papered over.
 */

import { cn } from "@shared/lib/utils";
import type { FC } from "react";
import {
	type MeshGeometry,
	NODE_WIDTH,
	SCOPE_ENCLOSURE_PAD,
	SCOPE_LEVEL_INSET,
	SCOPE_LEVEL_STEP,
} from "./mesh-positions";
import { type PrefixGroup, type ScopeStack, prefixWords } from "./mesh-scope";

/*
 * THE ENCLOSURE'S STANDOFF, ITS LABEL'S BAND AND THE STACK'S OWN PITCH LIVE IN
 * `mesh-positions.ts` (`SCOPE_ENCLOSURE_PAD`, `SCOPE_LABEL_BAND`, `SCOPE_OPEN_GAP`,
 * `SCOPE_LEVEL_STEP`, `SCOPE_LEVEL_INSET`), because the layout must reserve the room
 * the labels need above a row that opens a stack - a number this file reads is a number
 * this file must not own alone (design review round 1, D2: the old local
 * `ENCLOSURE_PAD` and the old "room to spare" comment here shipped a label 13.4 px
 * behind the node above; round 2 priced the STACK the same way, in the layout).
 */

type MeshScopeLayerProps = {
	stacks: readonly ScopeStack[];
	geometry: MeshGeometry;
};

/** A group's boxes that are on the canvas; empty means the frame has nothing to wrap. */
const memberBoxes = (group: PrefixGroup, geometry: MeshGeometry) =>
	group.deviceIds
		.map((id) => geometry.devices.get(id))
		.filter((box) => box !== undefined);

/*
 * ONE STACK, DRAWN OUTERMOST-FIRST (design ruling round 2: NEST + STAGGER). The groups
 * that share an opener become nested frames - each level 26 px higher
 * (`SCOPE_LEVEL_STEP`) and 4 px wider on both sides and further down
 * (`SCOPE_LEVEL_INSET`) than the one inside it - so two enclosures that used to
 * overprint one label on one anchor now draw two rings with their labels 26 px apart.
 * The label keeps its `bottom-full left-1 mb-0.5` anchor and rides its own frame's top
 * edge: the staircase is a consequence of the frames' offsets, not a second positioning
 * rule, which is why the ruling changed geometry rather than label placement. Rendering
 * outer-first also PAINTS outer-first, so an inner frame sits over its parent's line
 * where the two overlap.
 */
export const MeshScopeLayer: FC<MeshScopeLayerProps> = ({
	stacks,
	geometry,
}) => (
	<div aria-hidden="true" className="pointer-events-none absolute top-0 left-0">
		{stacks.map((stack) => {
			const levels = stack.groups.length;
			/*
			 * The frames' bottom edges are solved INNERMOST-FIRST: each outer level
			 * extends `SCOPE_LEVEL_INSET` past the one inside it unless its own members
			 * reach further down - a ring around the ring, the same rule the top edge
			 * follows by pitch. Solved here rather than in `mesh-scope.ts` because it is
			 * a drawing question: the geometry the layout prices is per-ROW.
			 */
			const bottoms = new Array<number>(levels).fill(0);
			let inner: number | null = null;
			for (let level = levels - 1; level >= 0; level -= 1) {
				const boxes = memberBoxes(stack.groups[level], geometry);
				const own =
					(boxes.length === 0
						? 0
						: Math.max(...boxes.map((box) => box.y + box.height))) +
					SCOPE_ENCLOSURE_PAD;
				inner = inner === null ? own : Math.max(own, inner + SCOPE_LEVEL_INSET);
				bottoms[level] = inner;
			}
			const opener = geometry.devices.get(stack.deviceId);
			return stack.groups.map((group, level) => {
				const boxes = memberBoxes(group, geometry);
				// A group whose boxes have all gone cannot happen through `meshGraph` (a group is
				// built from devices, and every device has a box) - and it is checked anyway,
				// because a frame computed from nothing is a boundary drawn around no device.
				if (boxes.length === 0) return null;
				const outward = levels - 1 - level;
				const left = Math.min(...boxes.map((box) => box.x));
				const right = Math.max(...boxes.map((box) => box.x));
				/*
				 * The top edge hangs off the OPENER's box - the row the stack's groups share -
				 * not off each group's own topmost member: that member IS the opener here (the
				 * stack is keyed on it), and anchoring every level to the one row is what keeps
				 * the staircase on one axis.
				 */
				const anchor = opener?.y ?? Math.min(...boxes.map((box) => box.y));
				const top = anchor - SCOPE_ENCLOSURE_PAD - SCOPE_LEVEL_STEP * outward;
				const declared = group.tier === "declared";
				const label = prefixWords(group);
				return (
					<div
						key={`${group.tier}:${group.prefix}`}
						data-mesh-scope={`${group.tier}:${group.prefix}`}
						data-mesh-scope-level={level}
						className={cn(
							"absolute rounded-lg",
							/*
							 * SOLID VS DASHED IS THE GRAMMAR (design round § 6): a dashed boundary is
							 * arithmetic on two published values, a solid one rests on an interface this
							 * process runs on (or on the operator's own declaration). The two must not be
							 * told apart by hue alone - the dash is the non-colour channel, and it is the
							 * same one a revoked membership already uses on the edge layer.
							 */
							group.tier === "probable"
								? "border border-dashed border-hairline-strong"
								: "border border-control",
						)}
						style={{
							left: left - SCOPE_ENCLOSURE_PAD - SCOPE_LEVEL_INSET * outward,
							top,
							width:
								right +
								NODE_WIDTH -
								left +
								(SCOPE_ENCLOSURE_PAD + SCOPE_LEVEL_INSET * outward) * 2,
							height: bottoms[level] - top,
						}}
					>
						{/*
						 * THE LABEL SITS ABOVE ITS ENCLOSURE, in a band the LAYOUT reserves for it
						 * (design review round 1, D2; UX U3; round 2's NEST + STAGGER). The comment
						 * here used to claim "the frame's top edge is the one place in this layout
						 * with room to spare", and the frames refused it: the band is
						 * `SCOPE_LABEL_BAND` + the pad, while the clear space above a row measured
						 * `ROW_GAP - SCOPE_ENCLOSURE_PAD` = 6 px, so 13.4 px of the label rendered
						 * behind the node above - which paints over this layer (DOM order scope ->
						 * edges -> nodes), and the layer is `aria-hidden`, so the label is the only
						 * place the tier's words reach anyone. The room comes from
						 * `mesh-positions.ts`: a row that opens a stack clears `scopeOpenGap(levels)`
						 * above itself, and the column's first such row clears
						 * `scopeTopClearance(levels)` at the world's top edge. Round 2 re-measured
						 * this against the STACK: the anchors stay `bottom-full left-1 mb-0.5`, and
						 * the frames' own 26 px / 4 px offsets do the staggering.
						 */}
						<span
							data-mesh-scope-label=""
							className={cn(
								"absolute bottom-full left-1 mb-0.5 whitespace-nowrap text-meta",
								group.tier === "probable" ? "text-ink-dim" : "text-ink-muted",
								// The declared tier's word is set apart from the inferred ones: an authored
								// boundary and a computed one are different claims, and the label is where a
								// reader meets that difference first.
								declared && "font-medium",
							)}
						>
							{label}
						</span>
					</div>
				);
			});
		})}
	</div>
);

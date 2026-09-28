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
 *     enclosure in the decorative `--color-hairline`, correctly quieter than the verified
 *     one, because its evidence is arithmetic on two published values.
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
import { DEVICE_HEIGHT, type MeshGeometry, NODE_WIDTH } from "./mesh-positions";
import { type PrefixGroup, prefixWords } from "./mesh-scope";

/**
 * How far the enclosure stands off the boxes it wraps.
 *
 * 10 px rather than the graph's own `ROW_GAP`: this is not a gap between things, it is a
 * frame AROUND things, and a frame that touched its contents would read as a third edge
 * of the node rather than as a grouping. Measured on the frame: 8-12 px reads as
 * "around", 4 px reads as "attached to".
 */
const ENCLOSURE_PAD = 10;

type MeshScopeLayerProps = {
	groups: readonly PrefixGroup[];
	geometry: MeshGeometry;
};

export const MeshScopeLayer: FC<MeshScopeLayerProps> = ({
	groups,
	geometry,
}) => (
	<div aria-hidden="true" className="pointer-events-none absolute top-0 left-0">
		{groups.map((group) => {
			const boxes = group.deviceIds
				.map((id) => geometry.devices.get(id))
				.filter((box) => box !== undefined);
			// A group whose boxes have all gone cannot happen through `meshGraph` (a group is
			// built from devices, and every device has a box) - and it is checked anyway,
			// because a frame computed from nothing is a boundary drawn around no device.
			if (boxes.length === 0) return null;
			const left = Math.min(...boxes.map((box) => box.x));
			const top = Math.min(...boxes.map((box) => box.y));
			const right = Math.max(...boxes.map((box) => box.x));
			const bottom = Math.max(...boxes.map((box) => box.y));
			const declared = group.tier === "declared";
			const label = prefixWords(group);
			return (
				<div
					key={`${group.tier}:${group.prefix}`}
					data-mesh-scope={`${group.tier}:${group.prefix}`}
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
							? "border border-dashed border-hairline"
							: "border border-control",
					)}
					style={{
						left: left - ENCLOSURE_PAD,
						top: top - ENCLOSURE_PAD,
						width: right + NODE_WIDTH - left + ENCLOSURE_PAD * 2,
						height: bottom + DEVICE_HEIGHT - top + ENCLOSURE_PAD * 2,
					}}
				>
					{/*
					 * THE LABEL SITS ABOVE THE ENCLOSURE rather than inside it: a label inside the
					 * frame would compete with the node it is next to for the same line, and the
					 * frame's top edge is the one place in this layout with room to spare.
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
		})}
	</div>
);

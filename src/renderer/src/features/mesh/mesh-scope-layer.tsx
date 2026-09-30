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
	DEVICE_HEIGHT,
	type MeshGeometry,
	NODE_WIDTH,
	SCOPE_ENCLOSURE_PAD,
} from "./mesh-positions";
import { type PrefixGroup, prefixWords } from "./mesh-scope";

/*
 * THE ENCLOSURE'S STANDOFF AND ITS LABEL'S BAND LIVE IN `mesh-positions.ts`
 * (`SCOPE_ENCLOSURE_PAD`, `SCOPE_LABEL_BAND`, `SCOPE_OPEN_GAP`), because the layout must
 * reserve the room the label needs above a row that opens an enclosure - a number this
 * file reads is a number this file must not own alone (design review round 1, D2: the
 * old local `ENCLOSURE_PAD` and the old "room to spare" comment here shipped a label
 * 13.4 px behind the node above).
 */

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
							? "border border-dashed border-hairline-strong"
							: "border border-control",
					)}
					style={{
						left: left - SCOPE_ENCLOSURE_PAD,
						top: top - SCOPE_ENCLOSURE_PAD,
						width: right + NODE_WIDTH - left + SCOPE_ENCLOSURE_PAD * 2,
						height: bottom + DEVICE_HEIGHT - top + SCOPE_ENCLOSURE_PAD * 2,
					}}
				>
					{/*
					 * THE LABEL SITS ABOVE THE ENCLOSURE, in a band the LAYOUT now reserves for it
					 * (design review round 1, D2; UX U3). The comment here used to claim "the frame's
					 * top edge is the one place in this layout with room to spare", and the frames
					 * refused it: the band is `SCOPE_LABEL_BAND` + the pad, while the clear space
					 * above a row measured `ROW_GAP - SCOPE_ENCLOSURE_PAD` = 6 px, so 13.4 px of the
					 * label rendered behind the node above - which paints over this layer (DOM order
					 * scope -> edges -> nodes), and the layer is `aria-hidden`, so the label is the
					 * only place the tier's words reach anyone. The room comes from
					 * `mesh-positions.ts`: a row that opens an enclosure clears `SCOPE_OPEN_GAP`
					 * above itself, and the column's first such row clears `SCOPE_TOP_CLEARANCE` at
					 * the world's top edge, where the 1024x768 frame measured the label cut by the
					 * canvas's own top edge (4.4 px of a 13.9 px box).
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

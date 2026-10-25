/**
 * The canvas's edges: one SVG path per MEMBERSHIP.
 *
 * `pointer-events: none` on the layer, and it is a rule rather than a default: an
 * edge carries exactly one meaning (this device is a member of this network), no
 * design needs to hover one, and an edge that swallowed pointer events would sit
 * over the canvas's own pan surface - the background a drag starts on.
 *
 * ONE LINE PER LIVE MEMBERSHIP. A revoked membership used to draw dashed here,
 * which kept a line to a network the device was no longer in and asked the
 * canvas to explain a membership that is an audit row rather than a link. The
 * list's revoked count owns that fact now; this layer draws only what is a
 * membership today.
 */

import type { FC } from "react";
import type { MeshEdge } from "./mesh-graph";
import { type MeshGeometry, edgePath } from "./mesh-positions";

type MeshEdgeLayerProps = {
	edges: readonly MeshEdge[];
	geometry: MeshGeometry;
	/** The device the reader is on: its own edges take a step, not a hue. */
	selectedDeviceId: string | null;
};

export const MeshEdgeLayer: FC<MeshEdgeLayerProps> = ({
	edges,
	geometry,
	selectedDeviceId,
}) => (
	<svg
		aria-hidden="true"
		className="pointer-events-none absolute top-0 left-0 overflow-visible"
		width={geometry.bounds.width}
		height={geometry.bounds.height}
	>
		{edges.map((edge) => {
			const from = geometry.networks.get(edge.networkId);
			const to = geometry.devices.get(edge.deviceId);
			/*
			 * A membership whose endpoint has no box cannot happen through
			 * `meshGraph` (an edge is pushed only for a member with an id, and a
			 * device node exists for every such member) - and it is still checked,
			 * because a path built from `undefined` renders as `M NaN NaN`, which
			 * is a silent blank rather than an error.
			 */
			if (!from || !to) return null;
			const lit =
				selectedDeviceId !== null && edge.deviceId === selectedDeviceId;
			return (
				<path
					key={edge.key}
					data-mesh-edge={edge.key}
					d={edgePath(from, to)}
					fill="none"
					strokeWidth={lit ? 2 : 1.5}
					/*
					 * A LIGHTNESS step for the selected device's edges, never the accent:
					 * the accent is spent on "this device" alone, and two meanings for one
					 * hue is the defect that put reachable on the neutral role in the first
					 * place.
					 */
					className={lit ? "stroke-ink" : "stroke-ink-dim"}
				/>
			);
		})}
	</svg>
);

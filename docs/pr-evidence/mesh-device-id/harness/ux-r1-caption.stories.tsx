/**
 * UX review round 1 (U1) capture harness: the move confirmation's option captions.
 *
 * WHY A HARNESS AND NOT A PRODUCT STORY. The same file must render the BEFORE half
 * on `main` (20225f33d0) and the AFTER half on the PR head, byte-identically, so
 * the only difference between the pairs is the product code under it. It is
 * copied UNTRACKED into `src/renderer/src/features/mesh/` for one Storybook run
 * (the repository's own `.storybook` config, so the app's real stylesheet and
 * theme frame - no second Tailwind compilation) and removed afterwards; this
 * archived copy is the one that ran.
 *
 * Everything on screen is the real path: `networkTopology`/`peerList` ->
 * `meshGraph` -> `resolveDrop` -> `MoveConfirmDialog`. Nothing is mocked but the
 * synthetic devices. The `state` arg picks the drop:
 *   - `recall`   a remote conversation recalled to this device (preselected move)
 *   - `absent`   the same recall from an owner the graph does not hold (full id)
 *   - `outbound` a local conversation moved to the peer
 *   - `copy`     the recall with the copy option chosen
 *
 * THE RECEIPT. After paint it writes `data-ux-measure` on `<html>`: the theme the
 * frame actually carries, the computed dialog and scrim backgrounds (the defect
 * that retracted earlier QA frames was a dialog painting `rgba(0, 0, 0, 0)`), and
 * the caption's geometry - content box against its container, line count and
 * scroll overflow - so a frame is never the only witness of a fit claim. It also
 * measures every locale's recall caption in the caption's own font, which is how
 * "the longest locale" is chosen by measured width rather than by character count.
 * `capturePending` holds the rig's shutter until the receipt is written.
 */
import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useMemo } from "react";
import { bundledCatalogues } from "../../../../i18n/keys.gen";
import { MoveConfirmDialog } from "./mesh-actions";
import { resolveDrop } from "./mesh-drop";
import { meshGraph } from "./mesh-graph";
import { networkTopology, peerList } from "./mesh-types";

const SELF = `d_${"a".repeat(32)}`;
const PEER = `d_0123456789${"b".repeat(22)}`;
const ABSENT = `d_${"1".repeat(32)}`;
const NET = `n_${"c".repeat(32)}`;
const RECALL_KEY = "ui.mesh.mesh_actions.the_copy_there_is_deleted_once_it";

type State = "recall" | "absent" | "outbound" | "copy";

const member = (device_id: string, name: string, role: string) => ({
	device_id,
	name,
	role,
	capabilities: ["sessions", "transfer"],
	active: true,
	suspect: false,
	endpoints: ["10.0.0.4:4097"],
	last_seen_at: 1_800_000_000,
	reachable: true,
	reason: "",
	scope: "",
});

const row = (fields: Record<string, unknown>) => ({
	id: "01234567890a",
	name: "Quarterly report draft",
	mtime: 1_800_000_000,
	preview: "",
	pinned: false,
	archived: false,
	live_state: "idle",
	locality: "local",
	owner_device: "",
	owner_device_name: "",
	reachable: true,
	unreachable_reason: "",
	placement: null,
	origin: null,
	last_synced_at: null,
	...fields,
});

function verdictFor(state: State) {
	const graph = meshGraph({
		topology: networkTopology({
			self_device_id: SELF,
			networks: [
				{
					network_id: NET,
					name: "home",
					epoch: 3,
					trust: "active",
					members: [
						member(SELF, "studio-mac", "admin"),
						member(PEER, "shared-node", "drive"),
					],
				},
			],
		}),
		peers: peerList({
			self_device_id: SELF,
			peers: [
				{
					device_id: PEER,
					name: "shared-node",
					reachable: true,
					unreachable_reason: "",
					last_seen_at: 1_800_000_000,
					session_count: 1,
					rtt_ms: null,
				},
			],
			degraded: [],
		}),
	});
	const context = {
		selfDeviceId: SELF,
		devices: new Map(graph.devices.map((device) => [device.id, device])),
		networks: new Map(graph.networks.map((network) => [network.id, network])),
	};
	const owner = state === "absent" ? ABSENT : PEER;
	if (state === "outbound") {
		return resolveDrop(
			{
				session: row({}) as never,
				ownerDeviceId: SELF,
				ownerLabel: "studio-mac",
			},
			{ kind: "device", deviceId: PEER },
			context,
		);
	}
	return resolveDrop(
		{
			session: row({
				locality: "remote",
				owner_device: owner,
				owner_device_name: "shared-node",
			}) as never,
			ownerDeviceId: owner,
			// The raw wire name a caller supplies; the resolver must not trust it.
			ownerLabel: "shared-node",
		},
		{ kind: "device", deviceId: SELF },
		context,
	);
}

function rgb(selector: string): string | null {
	const node = document.querySelector(selector);
	return node ? getComputedStyle(node).backgroundColor : null;
}

function measure(state: State) {
	const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
	const labels = [...(dialog?.querySelectorAll<HTMLElement>("label") ?? [])];
	const captions = labels.map((label) => {
		const caption = label.querySelector<HTMLElement>("span.text-meta");
		const radio = label.querySelector<HTMLInputElement>('input[type="radio"]');
		if (!caption) return null;
		const box = caption.getBoundingClientRect();
		const container = label.getBoundingClientRect();
		const style = getComputedStyle(caption);
		const lineHeight = Number.parseFloat(style.lineHeight);
		/* The caption is `display: block`, so its box is always the container's
		 * width; the TEXT's own extent is what says whether it fits. A Range over the
		 * text node gives the painted run and one client rect per line box. */
		const range = document.createRange();
		range.selectNodeContents(caption);
		const textBox = range.getBoundingClientRect();
		const lineRects = new Set(
			[...range.getClientRects()].map((rect) => Math.round(rect.top)),
		).size;
		return {
			textWidth: Math.round(textBox.width * 100) / 100,
			textLeft: Math.round(textBox.left * 100) / 100,
			textRight: Math.round(textBox.right * 100) / 100,
			captionLeft: Math.round(box.left * 100) / 100,
			textLineBoxes: lineRects,
			checked: radio?.checked ?? false,
			text: caption.textContent,
			captionWidth: Math.round(box.width * 100) / 100,
			captionHeight: Math.round(box.height * 100) / 100,
			containerWidth: Math.round(container.width * 100) / 100,
			containerInnerRight: Math.round((container.right - 12) * 100) / 100,
			captionRight: Math.round(box.right * 100) / 100,
			lineHeight,
			lines: lineHeight ? Math.round(box.height / lineHeight) : null,
			scrollOverflowX: caption.scrollWidth - caption.clientWidth,
			whiteSpace: style.whiteSpace,
			overflow: style.overflow,
			textOverflow: style.textOverflow,
		};
	});
	/* Every locale's recall caption, set in the caption's own computed font, so the
	 * longest one is picked by what it would occupy rather than by its length. */
	const probe = document.createElement("span");
	const sample = dialog?.querySelector<HTMLElement>("label span.text-meta");
	if (sample) probe.style.font = getComputedStyle(sample).font;
	probe.style.position = "absolute";
	probe.style.visibility = "hidden";
	probe.style.whiteSpace = "nowrap";
	document.body.append(probe);
	const localeWidths = Object.fromEntries(
		Object.entries(
			bundledCatalogues as Record<string, Record<string, string>>,
		).map(([locale, catalogue]) => {
			const value = catalogue[RECALL_KEY];
			if (!value) return [locale, null];
			probe.textContent = value;
			return [
				locale,
				Math.round(probe.getBoundingClientRect().width * 100) / 100,
			];
		}),
	);
	probe.remove();
	return {
		state,
		theme: document.documentElement.dataset.theme ?? null,
		lang: document.documentElement.lang || null,
		viewport: [window.innerWidth, window.innerHeight],
		dialogBg: rgb('[role="dialog"]'),
		scrimBg: rgb("[data-radix-dialog-overlay], .bg-scrim"),
		dialogWidth: dialog
			? Math.round(dialog.getBoundingClientRect().width * 100) / 100
			: null,
		captions,
		recallKeyPresent: localeWidths.en !== null,
		localeWidths,
	};
}

const CaptionDialog = ({ state }: { state: State }) => {
	const verdict = useMemo(() => verdictFor(state), [state]);
	useEffect(() => {
		document.documentElement.dataset.capturePending = "ux-caption";
		let cancelled = false;
		const settle = async () => {
			// Two frames: Radix mounts the portal, then paints the open state.
			await new Promise((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(resolve)),
			);
			if (state === "copy") {
				const copyRadio = [
					...document.querySelectorAll<HTMLInputElement>(
						'[role="dialog"] input[type="radio"]',
					),
				][1];
				copyRadio?.click();
				await new Promise((resolve) =>
					requestAnimationFrame(() => requestAnimationFrame(resolve)),
				);
			}
			await document.fonts.ready;
			if (cancelled) return;
			const receipt = JSON.stringify(measure(state));
			document.documentElement.dataset.uxMeasure = receipt;
			// The fixed-size wrapper is another origin; it reads the receipt from here.
			window.parent?.postMessage({ uxMeasure: receipt }, "*");
			delete document.documentElement.dataset.capturePending;
		};
		void settle();
		return () => {
			cancelled = true;
		};
	}, [state]);
	if (verdict.kind !== "plan") {
		return (
			<output data-ux-error="true">{`not a plan: ${verdict.kind}`}</output>
		);
	}
	return (
		<MoveConfirmDialog
			open
			plan={verdict.plan}
			alternatives={verdict.alternatives}
			risky={verdict.risky}
			busy={false}
			onCancel={() => undefined}
			onChoose={() => undefined}
		/>
	);
};

const meta: Meta<{ state: State }> = {
	title: "UX 1408/Move option caption",
	argTypes: {
		state: {
			control: { type: "select" },
			options: ["recall", "absent", "outbound", "copy"],
		},
	},
	args: { state: "recall" },
	parameters: { layout: "fullscreen" },
};
export default meta;

export const Caption: StoryObj<{ state: State }> = {
	render: ({ state }) => <CaptionDialog state={state} />,
};

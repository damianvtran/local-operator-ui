/* ------------------------------------------------------------------------- *
 * `mesh-tab`: the Mesh tab's device census, against a live daemon.
 *
 * THE DEFECT THIS SCENE EXISTS FOR. The operator's Mesh tab read
 * `damian-mesh · 3 devices · 2 revoked` over two full `cloud-node-1` device
 * cards, each saying "no answer", beside their Mac. The two cards were REVOKED
 * members: the relay keeps a membership row with `active: false` as an audit
 * tombstone (the device id is burned and the row is pruned after 90 days), and
 * there is no CLI verb to delete one - by design. The tab drew every tombstone
 * as a live device that had failed to answer, which is a claim the wire never
 * made: those devices were not asked, because they are no longer members.
 *
 * WHY A SCENE AND NOT A STORY. The stories stub the preload bridge, so they can
 * only photograph the fixture whoever wrote the story chose. This scene asks
 * the DAEMON for its own networks and peers, derives which device ids are live
 * and which memberships are revoked, and then holds the DOM to that answer: the
 * tab may not draw an id the read says is not a member any more.
 *
 * ONE SCENE, TWO ARMS, THE SAME BYTES (`--mesh-expect`). `tombstones` is the
 * base tree: every member id is a device node and a revoked one is drawn as a
 * peer that did not answer - the frames are the before half. `collapsed` is the
 * fixed tree: only live devices are nodes, and the revoked count is the one
 * quiet affordance that expands into the audit rows. Running the SAME scene on
 * both trees is what makes the pair a difference in the app rather than in the
 * rig; a value the scene does not know is refused rather than defaulted, for
 * the reason the driver's other expect flags are.
 *
 * WHAT IT CANNOT PROVE. That a tombstone's 90-day pruning happened (that is the
 * relay's own retention, and this scene only reads the row it leaves behind),
 * and that a revoked membership was ever created through this UI: the daemon's
 * fixture predates the run. It also cannot prove anything about a mesh with no
 * tombstone - the run refuses to produce frames without one, because a pair
 * photographed on a clean mesh would not be evidence about this defect at all.
 *
 * Needs `--backend` (the daemon this run owns, with the token above) and
 * `--theme` in each palette the evidence set claims. It does NOT take
 * `--backend-records`: that flag points other scenes at a run's config tree, and
 * this one reads only the daemon's HTTP API (`/v1/desktop/networks`,
 * `/v1/desktop/peers`), so a run that passed it would be describing a dependency
 * the scene does not have.
 *
 *   LOCAL_OPERATOR_DESKTOP_TOKEN="$(cat "$RIG/token")" \
 *   node scripts/renderer-driver.mjs --scene mesh-tab --mesh-expect collapsed \
 *     --backend http://127.0.0.1:<port> \
 *     --seed-onboarding-complete --theme localOperatorDark --out <dir>
 */

/**
 * The scene reads its own flags: the driver passes only its helpers, and every
 * flag comes from the same argv the driver parsed. This is the shape the
 * library-asset, sidebar-layout and sounds scenes already use.
 */
const flag = (name) => {
	const at = process.argv.indexOf(name);
	return at === -1 ? null : (process.argv[at + 1] ?? null);
};

const PALETTE_SLUG = {
	localOperatorDark: "dark",
	localOperatorLight: "light",
};

/**
 * IS THIS WIRE MEMBER STILL A MEMBER? (agent review round 1, F1)
 *
 * The shipped parser defaults a MISSING `active` to live - `mesh-types.ts` reads
 * it as `flag(raw.active, true)`, because the backend lists a network's members
 * and a tombstone would have to be marked as one. This scene used to test
 * `member.active` for truth, so on a daemon that omits the field it named every
 * live device a tombstone: its "refuse a mesh with no revoked membership" guard
 * then PASSED on a clean mesh and the frames were fiction. Asking `!== false` is
 * the parser's rule read out loud - only an explicit `false` is a tombstone.
 *
 * The scene deliberately reads raw wire JSON and not `networkTopology()`, so it
 * does not import the app's model to check the app; that also means this one
 * rule has to be held in step with the parser by hand, which is why it has a name.
 */
const isLive = (member) => member.active !== false;

/**
 * The base tree's silence copy. Top level because Biome's `useTopLevelRegex`
 * asks for it (agent review round 1, F5): a literal inside the per-device
 * callback is rebuilt on every element, and this one is tested against every
 * tombstone on every run.
 */
const NO_ANSWER = /no answer/i;

/** The mesh reads this run is evidence about, from the daemon itself. */
async function readMesh(backend, token) {
	const get = async (path) => {
		const response = await fetch(`${backend}${path}`, {
			headers: { authorization: `Bearer ${token}` },
		});
		if (!response.ok) {
			throw new Error(
				`--scene mesh-tab: ${path} answered ${response.status}; the scene needs a live daemon`,
			);
		}
		const body = await response.json();
		return body.result;
	};
	const topology = await get("/v1/desktop/networks");
	const peers = await get("/v1/desktop/peers");
	const members = topology.networks.flatMap((network) =>
		network.members
			.filter((member) => member.device_id)
			.map((member) => ({
				...member,
				network_id: network.network_id,
				network_name: network.name,
			})),
	);
	const ids = [...new Set(members.map((member) => member.device_id))];
	const liveIds = [
		...new Set(
			members
				.filter((member) => isLive(member))
				.map((member) => member.device_id),
		),
	];
	const tombstoneIds = ids.filter((id) => !liveIds.includes(id));
	const liveMemberships = members.filter((member) => isLive(member));
	const revokedMemberships = members.filter((member) => !isLive(member));
	return {
		peers: peers.peers,
		ids,
		liveIds,
		tombstoneIds,
		liveMemberships,
		revokedMemberships,
	};
}

/**
 * Everything this scene reads from one rendered screen, in ONE evaluate so the
 * numbers describe one layout rather than several a poll apart.
 */
const READ_DOM = `(() => {
	const text = (el) => (el ? (el.textContent ?? "").replace(/\\s+/g, " ").trim() : "");
	const devices = [...document.querySelectorAll("[data-mesh-device]")].map((el) => ({
		id: el.getAttribute("data-mesh-device"),
		state: el.getAttribute("data-mesh-state"),
		text: text(el),
	}));
	const rows = [...document.querySelectorAll("[data-mesh-device-row]")].map((el) => ({
		id: el.getAttribute("data-mesh-device-row"),
		state: el.getAttribute("data-mesh-state"),
		text: text(el),
	}));
	const revoked = document.querySelector("[data-mesh-revoked]");
	return {
		summary: text(document.querySelector("[data-mesh-summary]")),
		devices,
		rows,
		hasRevokedToggle: Boolean(document.querySelector("[data-mesh-revoked-toggle]")),
		revokedRows: revoked
			? [...revoked.querySelectorAll("[data-mesh-revoked-member]")].map((el) => ({
					id: el.getAttribute("data-mesh-revoked-member"),
					text: text(el),
				}))
			: null,
	};
})()`;

export async function sceneMeshTab({
	cdp,
	verb,
	capture,
	check,
	note,
	waitForCondition,
}) {
	const expect = flag("--mesh-expect") ?? "collapsed";
	if (expect !== "tombstones" && expect !== "collapsed") {
		throw new Error(
			`--mesh-expect must be "tombstones" or "collapsed" (got ${JSON.stringify(expect)}): the base tree and the fixed tree make different claims, and a default would let a run photograph the wrong half under the right name`,
		);
	}
	const theme = flag("--theme") ?? "localOperatorDark";
	const palette = PALETTE_SLUG[theme];
	if (!palette) {
		throw new Error(
			`--theme must be one of ${Object.keys(PALETTE_SLUG).join(", ")} (got ${JSON.stringify(theme)}): the frame's name claims a palette, and the driver checks the pixels against it`,
		);
	}
	const backend = flag("--backend");
	const token = process.env.LOCAL_OPERATOR_DESKTOP_TOKEN;
	if (!backend) {
		throw new Error(
			"--scene mesh-tab needs --backend: the tab's four states are backend-gated, and a run without one photographs the empty state",
		);
	}
	if (!token) {
		throw new Error(
			"--scene mesh-tab needs LOCAL_OPERATOR_DESKTOP_TOKEN: the scene asks the daemon for the same networks the app renders, and an unfetched fixture is a claim the scene cannot check",
		);
	}

	const mesh = await readMesh(backend, token);
	note(
		"the daemon's own census",
		JSON.stringify({
			deviceIds: mesh.ids.length,
			liveDeviceIds: mesh.liveIds.length,
			tombstoneDeviceIds: mesh.tombstoneIds.length,
			revokedMemberships: mesh.revokedMemberships.length,
		}),
	);
	/*
	 * THE FIXTURE IS PART OF THE CLAIM. A clean mesh would let both arms "pass"
	 * while proving nothing about a tombstone, so the run refuses one rather than
	 * filing a green pair of frames that cannot show the defect.
	 */
	check(
		"the mesh under test holds at least one revoked membership",
		mesh.revokedMemberships.length > 0,
		"the daemon answered a mesh with no `active: false` member; this scene's frames would not be evidence about tombstones",
		`${mesh.revokedMemberships.length} revoked membership(s)`,
	);
	if (mesh.revokedMemberships.length === 0) {
		throw new Error(
			"--scene mesh-tab: the daemon has no revoked membership to photograph",
		);
	}
	check(
		"the fixture separates live devices from tombstones",
		mesh.tombstoneIds.length > 0,
		"every member id is still live in some network; there is no tombstone-only device to hold the tab to",
		`${mesh.tombstoneIds.length} tombstone-only device id(s)`,
	);

	if (theme) await verb(cdp, "setTheme", theme);
	await verb(cdp, "navigate", "/mesh");
	const ready = await waitForCondition(
		cdp,
		`(() => {
			const summary = document.querySelector("[data-mesh-summary]");
			return Boolean(summary && summary.textContent.trim());
		})()`,
		20_000,
	);
	check(
		"the tab answered with a topology",
		ready.ok,
		`no summary line after ${ready.waitedMs}ms: the tab is still loading or the daemon refused`,
	);
	if (!ready.ok)
		throw new Error("--scene mesh-tab: the tab never left loading");
	await waitForCondition(
		cdp,
		`document.querySelectorAll("[data-mesh-device]").length > 0`,
		10_000,
	);

	const first = await cdp.evaluate(READ_DOM);
	note("the tab's first reading", JSON.stringify(first));

	if (expect === "tombstones") {
		/*
		 * THE BASE TREE'S CLAIM, stated as the DEFECT rather than as a pass: every
		 * member id is a node, the revoked ones included, and each of those wears the
		 * reach word for a peer that stayed silent. This is what the before frames are
		 * a photograph of; the check fails on the fixed tree, which is how one scene
		 * asserts two different trees without a flag deciding what it may read.
		 */
		check(
			"the base tree draws every member id as a device node",
			mesh.ids.every((id) => first.devices.some((device) => device.id === id)),
			`drawn ${first.devices.map((device) => device.id).join(", ")}; the daemon names ${mesh.ids.join(", ")}`,
		);
		const drawnTombstones = first.devices.filter((device) =>
			mesh.tombstoneIds.includes(device.id),
		);
		check(
			"the base tree draws a revoked tombstone as a peer that did not answer",
			drawnTombstones.length === mesh.tombstoneIds.length &&
				drawnTombstones.every((device) => NO_ANSWER.test(device.text)),
			`tombstone nodes: ${JSON.stringify(drawnTombstones.map((device) => device.text))}`,
			drawnTombstones
				.map((device) => `${device.id}: ${device.text}`)
				.join(" | "),
		);
	} else {
		/*
		 * THE FIXED TREE'S CLAIM: the device id set is the LIVE set, and a revoked
		 * membership is not a node. The census keeps the fact - the summary names the
		 * count, and one disclosure carries the audit rows.
		 */
		const drawnIds = first.devices.map((device) => device.id);
		check(
			"the device nodes are exactly the live member ids",
			first.devices.length === mesh.liveIds.length &&
				mesh.liveIds.every((id) => drawnIds.includes(id)),
			`drawn ${drawnIds.join(", ")}; live ${mesh.liveIds.join(", ")}`,
			`${first.devices.length} live node(s)`,
		);
		check(
			"no revoked tombstone is drawn as a device node",
			mesh.tombstoneIds.every((id) => !drawnIds.includes(id)),
			`a tombstone id is still a node: ${mesh.tombstoneIds
				.filter((id) => drawnIds.includes(id))
				.join(", ")}`,
		);
		check(
			"the census names the revoked count",
			first.summary.includes(`${mesh.revokedMemberships.length} revoked`),
			`summary read "${first.summary}", expected "${mesh.revokedMemberships.length} revoked"`,
			first.summary,
		);
		check(
			"one quiet affordance carries the revoked audit rows",
			first.hasRevokedToggle,
			"no [data-mesh-revoked-toggle]: the count is stated but nothing can be inspected",
		);
	}

	// 1. The canvas, in the palette this run claims.
	const canvasFrame = await capture(cdp, `mesh-canvas-${palette}`);
	note("frame", JSON.stringify(canvasFrame));

	// 2. The list: the same read, one row per live membership.
	const listToggle = await verb(cdp, "press", {
		selector: '[data-mesh-presentation="list"]',
	});
	note("the List control", JSON.stringify(listToggle).slice(0, 240));
	const listed = await waitForCondition(
		cdp,
		`document.querySelectorAll("[data-mesh-device-row]").length > 0`,
		10_000,
	);
	check(
		"the list rendered its rows",
		listed.ok,
		`no [data-mesh-device-row] after ${listed.waitedMs}ms`,
	);
	const list = await cdp.evaluate(READ_DOM);
	note("the list's reading", JSON.stringify(list));

	if (expect === "tombstones") {
		check(
			"the base list files every membership under its network, revoked ones included",
			list.rows.length ===
				mesh.liveMemberships.length + mesh.revokedMemberships.length,
			`${list.rows.length} row(s) for ${mesh.liveMemberships.length + mesh.revokedMemberships.length} memberships`,
			`${list.rows.length} row(s), ${mesh.tombstoneIds.length} tombstone id(s) among them`,
		);
		check(
			"the base list draws a tombstone as a device row",
			mesh.tombstoneIds.some((id) => list.rows.some((row) => row.id === id)),
			"no tombstone id reached the list; this is not the before state",
		);
	} else {
		check(
			"the list files one row per LIVE membership and none for a tombstone",
			list.rows.length === mesh.liveMemberships.length &&
				mesh.tombstoneIds.every(
					(id) => !list.rows.some((row) => row.id === id),
				),
			`${list.rows.length} row(s) for ${mesh.liveMemberships.length} live membership(s); tombstone rows: ${list.rows
				.filter((row) => mesh.tombstoneIds.includes(row.id))
				.map((row) => row.id)
				.join(", ")}`,
			`${list.rows.length} live row(s)`,
		);
	}
	const listFrame = await capture(cdp, `mesh-list-${palette}`);
	note("frame", JSON.stringify(listFrame));

	if (expect === "collapsed") {
		/*
		 * THE AFFORDANCE, OPENED WITH A REAL PRESS. The audit rows are the fact the
		 * tombstone cards used to carry (a device named cloud-node-1, and its id); the
		 * claim is that both survive the change, not that they disappeared with the
		 * nodes. Pressed after the list frame so the closed state is on the record too.
		 */
		const opened = await verb(cdp, "press", {
			selector: "[data-mesh-revoked-toggle]",
		});
		note("the revoked count", JSON.stringify(opened).slice(0, 240));
		const expanded = await waitForCondition(
			cdp,
			`Boolean(document.querySelector("[data-mesh-revoked]"))`,
			10_000,
		);
		check(
			"the revoked count expands into its audit rows",
			expanded.ok,
			`no [data-mesh-revoked] after ${expanded.waitedMs}ms`,
		);
		const open = await cdp.evaluate(READ_DOM);
		check(
			"every revoked membership is named, with the device id that was burned",
			open.revokedRows !== null &&
				open.revokedRows.length === mesh.revokedMemberships.length &&
				mesh.revokedMemberships.every((member) =>
					open.revokedRows.some(
						(row) =>
							row.id === member.device_id &&
							row.text.includes(member.device_id),
					),
				),
			`rows: ${JSON.stringify(open.revokedRows)}; daemon: ${JSON.stringify(
				mesh.revokedMemberships.map((member) => member.device_id),
			)}`,
			open.revokedRows?.map((row) => row.text).join(" | "),
		);
		const openFrame = await capture(cdp, `mesh-revoked-open-${palette}`);
		note("frame", JSON.stringify(openFrame));
	}
}

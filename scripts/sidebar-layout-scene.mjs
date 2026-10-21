/* ------------------------------------------------------------------------- *
 * `sidebar-layout`: the customisable destination rail, driven end to end
 * against a live backend.
 *
 * WHY THIS MODULE. `scripts/renderer-driver.mjs` sits under Biome's 2 MiB
 * single-file ceiling, so this scene joins the agent-messages, library-asset
 * and sounds scenes in its own module rather than pushing the driver over. The
 * driver passes its own `check`, `note`, `wait`, `capture` and helpers in, so
 * every assertion and frame here runs on the same instruments as an inline
 * scene; the flags are read from the same argv the driver parsed.
 * ------------------------------------------------------------------------- */

/**
 * `--scene sidebar-layout`: the customisable destination rail, DRIVEN end to end
 * against a live backend.
 *
 * WHY THIS SCENE EXISTS. `docs/design/sidebar-customisation.md` § 8 asks for
 * evidence of six results no `node --test` file can reach: a row dragged out of
 * the fold and a visible row re-ordered, the same two moves through the row
 * menu, a keyboard-only sequence, the fold emptied, Aida folded away with her
 * badge, and the arrangement after a reload. Each is a claim about a GESTURE and
 * about PIXELS - a drag only arms after 5px of trusted movement, the insertion
 * line exists only between a press and a release, and the order is stored on the
 * BACKEND rather than in the renderer - so every gesture here goes through
 * `Input.dispatchMouseEvent`/`Input.dispatchKeyEvent` and every reading is the
 * app's own DOM and geometry.
 *
 * WHAT A FRAME HERE PROVES, AND WHAT IT CANNOT.
 *   - The gestures enter Chromium's own input pipeline, so the element under the
 *     pointer is found the way a hand's would be. They are still synthetic: no
 *     pressure, no jitter, and a headless window never paints `:focus-visible`,
 *     so the keyboard frames are about focus LOCATION and the row's order rather
 *     than about the ring.
 *   - The store is the REAL backend's (`--backend` names an isolated daemon).
 *     Its starting arrangement is seeded to the design's defaults by this
 *     module's OWN PREFLIGHT, run by the driver BEFORE the app boots: the
 *     layout is read once per mount, so a PUT issued after boot reaches a rail
 *     that already read the previous arrangement and will not re-read it
 *     (measured - a scene-side reset was accepted by the backend and the rail
 *     still painted the last run's order). The scene reads the store back and
 *     asserts the seed landed.
 *   - Step 9 reloads the RENDERER. That proves the arrangement is re-read from
 *     the backend when the renderer mounts; it is NOT a process restart, which
 *     is QA's half of the acceptance test.
 *   - The Aida-in-More badge needs an attention count from a completed turn,
 *     which this fixture cannot manufacture. The scene records the Aida-in-More
 *     layout and says whether the badge was drawn; the badge state itself is
 *     named as needing the QA turn path rather than failed for a fixture limit.
 */
/*
 * THE DEFAULT ARRANGEMENT, taken from the design contract (§ 2) rather than from
 * the app: the pre-boot seed and the scene's assertions must agree about the
 * same list, and a copy read back from the app would agree with any order it
 * drew.
 */
const DEFAULT_VISIBLE = [
	"aida",
	"library",
	"projects",
	"agents",
	"schedules",
	"browser",
];
const DEFAULT_MORE = ["team-bridge", "agent-hub", "mesh"];

/*
 * THE DRIVER'S ARGV, read here for the same reason `library-asset-scene.mjs`
 * reads its own: the driver is at Biome's single-file ceiling, so its dispatch
 * passes the helpers and every flag is read from the same argv it parsed.
 */
const flagValue = (name) => {
	const at = process.argv.indexOf(name);
	if (at === -1) return null;
	const value = process.argv[at + 1];
	return value === undefined || value.startsWith("--") ? null : value;
};

/** The resource's route, addressed on the backend this run was given. */
const sidebarLayoutUrl = (backend) => `${backend}/v1/desktop/sidebar-layout`;

/** The bearer, from this script's environment and never from argv. */
const desktopBearer = () => {
	const token = process.env.LOCAL_OPERATOR_DESKTOP_TOKEN;
	if (!token) {
		throw new Error(
			"--scene sidebar-layout reads its bearer from LOCAL_OPERATOR_DESKTOP_TOKEN in this script's environment, never from argv: without it the fixture cannot be seeded and the app cannot authenticate",
		);
	}
	return token;
};

/**
 * Seed the starting arrangement, called by the driver's PREFLIGHT.
 *
 * WHY BEFORE THE BOOT: the layout is read ONCE PER MOUNT (design § 7), and the
 * sidebar mounts during boot. A PUT from inside the scene reaches a client that
 * has already read the previous arrangement; `staleTime: Infinity` means
 * navigating afterwards does not re-read it either. Measured on this scene's
 * fourth run: the PUT was accepted and returned the defaults, and the rail
 * painted the third run's final order - so the seed moved here, before
 * `launchApp`, and the scene now only reads the store back.
 */
export async function prepareSidebarLayoutScene() {
	const backend = flagValue("--backend");
	if (backend === null) {
		throw new Error(
			"--scene sidebar-layout needs --backend: every move this scene makes is stored on the backend, and a run with none photographs a rail that cannot be customised at all",
		);
	}
	const response = await fetch(sidebarLayoutUrl(backend), {
		method: "PUT",
		headers: {
			"content-type": "application/json",
			authorization: `Bearer ${desktopBearer()}`,
		},
		body: JSON.stringify({
			layout: { visible: DEFAULT_VISIBLE, more: DEFAULT_MORE },
		}),
	});
	const body = await response.json().catch(() => null);
	if (!response.ok) {
		throw new Error(
			`the sidebar-layout seed was refused (${response.status}): ${JSON.stringify(body)}`,
		);
	}
	return body?.result?.layout ?? body?.layout ?? null;
}

export async function sceneSidebarLayout({
	cdp,
	verb,
	capture,
	check,
	note,
	wait,
	waitForCondition,
	factsOf,
	require,
	parkPointer,
	pressPointer,
}) {
	const MOVE_TO_MORE = "Move to More";
	const SHOW_IN_SIDEBAR = "Show in sidebar";
	const RESET_LAYOUT = "Reset sidebar layout";
	/*
	 * Longer than the row's colour transition (`duration-fast`, 120ms), so a
	 * frame after a pointer move is of the settled row rather than one caught
	 * mid-fade.
	 */
	const SETTLE_MS = 400;
	const frames = [];
	const frame = async (label) => {
		const shot = await capture(cdp, label);
		frames.push(shot);
		note("frame", JSON.stringify({ label, ...shot }));
		return shot;
	};

	const backend = flagValue("--backend");
	const theme = flagValue("--theme");
	const facts = await factsOf(cdp);
	check(
		"window mode is headless",
		facts.windowMode === "headless",
		facts.windowMode,
	);
	check(
		"the window is never shown and never focused",
		facts.visible === false && facts.focused === false,
		`visible=${facts.visible} focused=${facts.focused}`,
	);
	const hello = await verb(cdp, "hello");
	/* The frames directory the renderer was armed with, read rather than assumed. */
	const framesDir = hello.outDir;
	if (theme !== null) {
		const themed = await verb(cdp, "setTheme", theme);
		check(
			"the run's theme is the one this launch asked for",
			themed.theme === theme,
			JSON.stringify(themed),
		);
	}

	/** The arrangement the backend currently stores, for the seed and the reload. */
	const readStoredLayout = async () => {
		const response = await fetch(sidebarLayoutUrl(backend), {
			headers: { authorization: `Bearer ${desktopBearer()}` },
		});
		const body = await response.json().catch(() => null);
		return body?.result?.layout ?? body?.layout ?? null;
	};

	/*
	 * THE PREFLIGHT'S SEED, READ BACK. The driver put the defaults on the backend
	 * before it launched the app (see `prepareSidebarLayoutScene`); a mismatch here
	 * means the seed did not land and every order below would be read against a
	 * different starting arrangement than the one the assertions name.
	 */
	const startingStore = await readStoredLayout();
	check(
		"the backend holds the default arrangement this run was booted against",
		startingStore !== null &&
			JSON.stringify(startingStore.visible) ===
				JSON.stringify(DEFAULT_VISIBLE) &&
			JSON.stringify(startingStore.more) === JSON.stringify(DEFAULT_MORE),
		JSON.stringify(startingStore),
	);

	/**
	 * One reading of the rail: the rows in document order with the region each is
	 * DRAWN in, the fold's own control and badge, the live insertion line and its
	 * computed paint, the trailing band, and the open menu. Read from the DOM
	 * rather than inferred from the store, because the claims below are about
	 * what a reader sees.
	 */
	const readSidebar = () =>
		cdp.evaluate(`(() => {
			const box = (node) => {
				const r = node.getBoundingClientRect();
				return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2) };
			};
			const area = document.querySelector('[data-sidebar-destinations-area]');
			const moreRow = document.querySelector('[data-sidebar-more]');
			const rows = Array.from(document.querySelectorAll('[data-sidebar-row]')).map((node) => ({
				id: node.getAttribute('data-sidebar-row'),
				region: node.getAttribute('data-sidebar-region'),
				box: box(node),
				menuTrigger: node.querySelector('[data-sidebar-row-menu]') !== null,
			}));
			const indicatorNode = area === null ? null : (Array.from(area.children).find((child) => child.tagName === 'SPAN' && child.getBoundingClientRect().height > 0) ?? null);
			const indicator = indicatorNode === null ? null : (() => {
				const style = getComputedStyle(indicatorNode);
				const r = indicatorNode.getBoundingClientRect();
				return { h: Math.round(r.height), top: Math.round(r.top), x: Math.round(r.left), w: Math.round(r.width), bg: style.backgroundColor, cls: String(indicatorNode.className) };
			})();
			const menu = document.querySelector('[role="menu"]');
			const active = document.activeElement === null ? null : {
				tag: document.activeElement.tagName,
				text: (document.activeElement.textContent || '').trim().slice(0, 80),
				inMenu: document.activeElement.closest('[role="menu"]') !== null,
			};
			return {
				rows,
				visible: rows.filter((row) => row.region === 'visible').map((row) => row.id),
				more: rows.filter((row) => row.region === 'more').map((row) => row.id),
				moreRow: moreRow === null ? null : {
					box: box(moreRow),
					expanded: moreRow.getAttribute('aria-expanded') === 'true',
					label: moreRow.getAttribute('aria-label'),
					badge: moreRow.querySelector('[data-tour-tag="nav-more-badge"]') !== null,
				},
				area: area === null ? null : { box: box(area), dragging: area.hasAttribute('data-sidebar-dragging') },
				indicator,
				band: document.querySelector('[data-sidebar-drop-band]') === null ? null : (() => {
					const node = document.querySelector('[data-sidebar-drop-band]');
					return { ...box(node), text: (node.textContent || '').trim() };
				})(),
				menu: menu === null ? null : {
					left: Math.round(menu.getBoundingClientRect().left),
					items: Array.from(menu.querySelectorAll('[role="menuitem"]')).map((item) => ({
						label: (item.textContent || '').trim(),
						disabled: item.getAttribute('data-disabled') !== null || item.getAttribute('aria-disabled') === 'true',
					})),
				},
				active,
			};
		})()`);

	/** Poll the rail until `predicate` holds; the answer carries the last reading. */
	const waitForSidebar = async (predicate, timeoutMs = 8_000) => {
		const started = Date.now();
		let snapshot = null;
		for (;;) {
			snapshot = await readSidebar();
			if (predicate(snapshot)) {
				return { ok: true, snapshot, waitedMs: Date.now() - started };
			}
			if (Date.now() - started > timeoutMs) {
				return { ok: false, snapshot, waitedMs: Date.now() - started };
			}
			await wait(120);
		}
	};

	/** The fold is a disclosure, not the layout: open it before reading `more`. */
	const ensureFoldOpen = async () => {
		let snapshot = await readSidebar();
		if (snapshot.moreRow !== null && snapshot.moreRow.expanded === false) {
			await pressPointer(cdp, snapshot.moreRow.box.cx, snapshot.moreRow.box.cy);
			const opened = await waitForSidebar(
				(state) => state.moreRow !== null && state.moreRow.expanded === true,
				5_000,
			);
			snapshot = opened.snapshot;
		}
		return snapshot;
	};

	/** One point-press, one point-release: the drag's two ends. */
	const pressAt = (x, y) =>
		cdp.send("Input.dispatchMouseEvent", {
			type: "mousePressed",
			x,
			y,
			button: "left",
			buttons: 1,
			clickCount: 1,
		});
	const dragMoveTo = (x, y) =>
		cdp.send("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			x,
			y,
			button: "left",
			buttons: 1,
		});
	const releaseAt = (x, y) =>
		cdp.send("Input.dispatchMouseEvent", {
			type: "mouseReleased",
			x,
			y,
			button: "left",
			buttons: 0,
			clickCount: 1,
		});

	/**
	 * Drag a row to a target y in steps, the way a hand makes one. The steps are
	 * what make the mid-gesture frame a HELD gesture rather than a jump: a single
	 * move to the target would arm and land in the same event.
	 */
	const dragRowTo = async (id, targetY, midLabel) => {
		const start = (await readSidebar()).rows.find((row) => row.id === id);
		require(`the ${id} row is drawn where the drag starts`, start !==
			undefined, JSON.stringify((await readSidebar()).visible));
		const x = start.box.cx;
		await pressAt(x, start.box.cy);
		const steps = 12;
		for (let step = 1; step <= steps; step += 1) {
			const y = Math.round(
				start.box.cy + ((targetY - start.box.cy) * step) / steps,
			);
			await dragMoveTo(x, y);
			await wait(40);
		}
		await wait(160);
		const held = await readSidebar();
		const shot = midLabel === undefined ? null : await frame(midLabel);
		return { held, shot, x, y: targetY };
	};

	/** `Input.dispatchKeyEvent` for one chord, as the row's handlers read it. */
	const sendKey = async (
		key,
		{ code = key, modifiers = 0, windowsVirtualKeyCode = 0 } = {},
	) => {
		const base = {
			key,
			code,
			modifiers,
			windowsVirtualKeyCode,
			nativeVirtualKeyCode: windowsVirtualKeyCode,
		};
		await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base });
		await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
	};

	/** The open menu's item whose visible text is exactly `label`. */
	const menuItemAt = (label) =>
		cdp.evaluate(`(() => {
			const items = Array.from(document.querySelectorAll('[role="menuitem"]'));
			const wanted = ${JSON.stringify(label)};
			const item = items.find((node) => (node.textContent || '').trim() === wanted);
			if (!item) return { found: false, items: items.map((node) => (node.textContent || '').trim()) };
			const r = item.getBoundingClientRect();
			return {
				found: true,
				x: Math.round(r.left + r.width / 2),
				y: Math.round(r.top + r.height / 2),
				disabled: item.getAttribute('data-disabled') !== null || item.getAttribute('aria-disabled') === 'true',
				items: items.map((node) => (node.textContent || '').trim()),
			};
		})()`);

	/** Press one item in the open row menu. */
	const chooseMenuItem = async (label) => {
		const item = await menuItemAt(label);
		check(
			`the row menu offers "${label}"`,
			item.found === true && item.disabled === false,
			JSON.stringify(item),
		);
		if (item.found !== true) return false;
		await pressPointer(cdp, item.x, item.y);
		return true;
	};

	/**
	 * Open one row's menu. Two real doors and one stated fallback: the trailing
	 * ellipsis (`click`), the row itself (right-button press), and - only when the
	 * real press produced no menu - a `contextmenu` event emitted at the row's
	 * centre, which is the door the task allows and which the scene says it used.
	 */
	const openRowMenu = async (id, { via = "contextmenu" } = {}) => {
		const snapshot = await readSidebar();
		const row = snapshot.rows.find((each) => each.id === id);
		require(`the ${id} row is drawn for its menu`, row !==
			undefined, JSON.stringify({
			visible: snapshot.visible,
			more: snapshot.more,
		}));
		if (via === "ellipsis") {
			require(`the ${id} row draws its ellipsis trigger`, row.menuTrigger ===
				true, JSON.stringify(row));
			const trigger = await cdp.evaluate(`(() => {
				const node = document.querySelector('[data-sidebar-row="${id}"] [data-sidebar-row-menu]');
				if (node === null) return null;
				const r = node.getBoundingClientRect();
				return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
			})()`);
			require(`the ${id} row's ellipsis has a box`, trigger !==
				null, JSON.stringify(trigger));
			await pressPointer(cdp, trigger.x, trigger.y);
		} else {
			const x = row.box.cx;
			const y = row.box.cy;
			await cdp.send("Input.dispatchMouseEvent", {
				type: "mouseMoved",
				x,
				y,
				button: "none",
				buttons: 0,
			});
			await cdp.send("Input.dispatchMouseEvent", {
				type: "mousePressed",
				x,
				y,
				button: "right",
				buttons: 2,
				clickCount: 1,
			});
			await cdp.send("Input.dispatchMouseEvent", {
				type: "mouseReleased",
				x,
				y,
				button: "right",
				buttons: 0,
				clickCount: 1,
			});
			let opened = await waitForCondition(
				cdp,
				"document.querySelector('[role=\"menu\"]') !== null",
				1_200,
			);
			if (opened.ok !== true) {
				await cdp.evaluate(
					`(() => {
						const node = document.querySelector('[data-sidebar-row="${id}"]');
						node.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: ${x}, clientY: ${y} }));
						return true;
					})()`,
				);
				note(
					`the ${id} menu's opening path`,
					"the real right-button press produced no menu; an emitted contextmenu event at the row's centre opened it",
				);
				opened = await waitForCondition(
					cdp,
					"document.querySelector('[role=\"menu\"]') !== null",
					3_000,
				);
			}
			check(
				`the ${id} row's menu opens`,
				opened.ok === true,
				JSON.stringify(opened),
			);
		}
		const menu = await waitForSidebar((state) => state.menu !== null, 3_000);
		return menu;
	};

	await verb(cdp, "navigate", "/chat");
	const arrived = await waitForCondition(
		cdp,
		'document.querySelectorAll("[data-sidebar-row]").length > 0 && document.querySelector("[data-sidebar-row-menu]") !== null',
		30_000,
	);
	check(
		"the rail mounted and the stored layout unlocked its row menus",
		arrived.ok === true,
		JSON.stringify(arrived),
	);
	await wait(SETTLE_MS);
	await parkPointer(cdp);

	/*
	 * 1. THE DEFAULT FOLD. The More control is drawn and closed; the visible rows
	 * are the shipped order with the capability-hidden ids removed.
	 */
	const boot = await readSidebar();
	const missing = DEFAULT_VISIBLE.filter((id) => !boot.visible.includes(id));
	check(
		"the rows this scene drives are all drawn on this backend",
		missing.length === 0,
		`missing: ${missing.join(", ")}`,
	);
	require("the rail's rows the drag path names are present", [
		"agents",
		"schedules",
		"browser",
		"projects",
		"library",
		"aida",
	].every((id) => boot.visible.includes(id)), JSON.stringify(boot.visible));
	const expectedBootVisible = DEFAULT_VISIBLE.filter((id) =>
		boot.visible.includes(id),
	);
	check(
		"the visible rows are the default order among the rows this backend offers",
		JSON.stringify(boot.visible) === JSON.stringify(expectedBootVisible) &&
			boot.rows.every((row) => row.region === "visible"),
		JSON.stringify({ visible: boot.visible, expected: expectedBootVisible }),
	);
	check(
		"the More control is drawn and closed",
		boot.moreRow !== null && boot.moreRow.expanded === false,
		JSON.stringify(boot.moreRow),
	);
	check(
		"no insertion line is drawn at rest",
		boot.indicator === null && boot.area?.dragging === false,
		JSON.stringify({ indicator: boot.indicator, area: boot.area }),
	);
	await frame("sidebar-default");

	/*
	 * 2. THE FOLD OPEN, and the default order inside it. The press is the reader's
	 * own door: the More control, through the pointer.
	 */
	await pressPointer(cdp, boot.moreRow.box.cx, boot.moreRow.box.cy);
	const open = await waitForSidebar(
		(state) =>
			state.moreRow !== null &&
			state.moreRow.expanded === true &&
			state.more.length > 0,
		6_000,
	);
	check(
		"pressing the More row opens the fold",
		open.ok === true,
		JSON.stringify(open.snapshot?.moreRow),
	);
	await wait(SETTLE_MS);
	const folded = await readSidebar();
	const expectedMore = DEFAULT_MORE.filter((id) => folded.more.includes(id));
	check(
		"the fold's rows are the default More order, each drawn in the more region",
		JSON.stringify(folded.more) === JSON.stringify(expectedMore) &&
			folded.rows
				.filter((row) => folded.more.includes(row.id))
				.every((row) => row.region === "more"),
		JSON.stringify({ more: folded.more, expected: expectedMore }),
	);
	check(
		"the visible region did not move when the fold opened",
		JSON.stringify(folded.visible) === JSON.stringify(boot.visible),
		JSON.stringify(folded.visible),
	);
	await frame("sidebar-more-open");

	/*
	 * 3. DRAG OUT OF THE FOLD. `team-bridge` is dropped between `agents` and
	 * `schedules`: the pointer's target is just inside `schedules`' own top, which
	 * is past `agents`' midpoint and not yet past `schedules`', so the app's own
	 * midpoint rule resolves that slot. The frame is taken while the press is
	 * held and the line is drawn.
	 */
	require("the fold carries a row to drag out", folded.more.includes(
		"team-bridge",
	), JSON.stringify(folded.more));
	/*
	 * THE FOLD'S OWN SIZE, measured rather than assumed: `mesh` is capability-gated
	 * (a device that is not in one) and this backend does not offer it, so the
	 * count after the drag is one fewer than before rather than a literal 2.
	 */
	const moreBeforeDrag = folded.more.length;
	const schedulesTop = folded.rows.find((row) => row.id === "schedules").box.y;
	const dragOut = await dragRowTo(
		"team-bridge",
		schedulesTop + 4,
		"sidebar-drag-out-mid",
	);
	const indicator = dragOut.held.indicator;
	check(
		"the pointer arms the gesture and draws the dragging state on the rail",
		dragOut.held.area !== null && dragOut.held.area.dragging === true,
		JSON.stringify(dragOut.held.area),
	);
	check(
		"the insertion line is drawn between the rows the pointer is between",
		indicator !== null &&
			indicator.h === 2 &&
			indicator.bg !== "rgba(0, 0, 0, 0)" &&
			indicator.bg !== "transparent" &&
			indicator.cls.includes("bg-accent"),
		JSON.stringify({
			indicator,
			expectedHeight: 2,
			schedulesTop,
			agentsTop: dragOut.held.rows.find((row) => row.id === "agents")?.box.y,
		}),
	);
	check(
		"the line's own top is the landing row's top",
		indicator !== null && Math.abs(indicator.top - schedulesTop) <= 2,
		JSON.stringify({ indicatorTop: indicator?.top, schedulesTop }),
	);
	check(
		"the drop band states the direction of a More row's drag",
		dragOut.held.band !== null && dragOut.held.band.text === SHOW_IN_SIDEBAR,
		JSON.stringify({
			band: dragOut.held.band,
			expected: SHOW_IN_SIDEBAR,
		}),
	);
	await releaseAt(dragOut.x, dragOut.y);
	const landed = await waitForSidebar((state) => {
		const row = state.rows.find((each) => each.id === "team-bridge");
		return row !== undefined && row.region === "visible";
	}, 10_000);
	require("the drop lands team-bridge in the visible region", landed.ok ===
		true, JSON.stringify({
		visible: landed.snapshot?.visible,
		more: landed.snapshot?.more,
	}));
	await wait(SETTLE_MS);
	await parkPointer(cdp);
	const afterDrop = await readSidebar();
	const agentsAt = afterDrop.visible.indexOf("agents");
	check(
		"team-bridge lands immediately after agents and before schedules",
		afterDrop.visible[agentsAt + 1] === "team-bridge" &&
			afterDrop.visible[agentsAt + 2] === "schedules",
		JSON.stringify(afterDrop.visible),
	);
	check(
		"the fold is still drawn with the rows that stayed in it",
		afterDrop.moreRow !== null && afterDrop.more.length === moreBeforeDrag - 1,
		JSON.stringify({
			moreRow: afterDrop.moreRow,
			more: afterDrop.more,
			expected: moreBeforeDrag - 1,
		}),
	);
	check(
		"the gesture left no insertion line and no dragging state behind",
		afterDrop.indicator === null && afterDrop.area?.dragging === false,
		JSON.stringify({ indicator: afterDrop.indicator, area: afterDrop.area }),
	);
	await frame("sidebar-drag-out-after");

	/*
	 * 4. A VISIBLE REORDER. `browser` is dragged above `agents`; the target is
	 * just inside `agents`' top, so the same midpoint rule draws the line there.
	 */
	const agentsTop = afterDrop.rows.find((row) => row.id === "agents").box.y;
	const reorder = await dragRowTo("browser", agentsTop + 3);
	/*
	 * THE OTHER DIRECTION (agent review round 1, R1-6a): the band's label is read,
	 * not merely its existence - a "Show in sidebar" band during a visible row's
	 * drag would otherwise pass the older check.
	 */
	check(
		"the drop band states the direction of a visible row's drag",
		reorder.held.band !== null && reorder.held.band.text === MOVE_TO_MORE,
		JSON.stringify({ band: reorder.held.band, expected: MOVE_TO_MORE }),
	);
	await releaseAt(reorder.x, reorder.y);
	const reordered = await waitForSidebar((state) => {
		const browser = state.visible.indexOf("browser");
		const agents = state.visible.indexOf("agents");
		return browser !== -1 && agents !== -1 && browser < agents;
	}, 10_000);
	require("the visible reorder arms and lands browser before agents", reordered.ok ===
		true, JSON.stringify(reordered.snapshot?.visible));
	await wait(SETTLE_MS);
	await parkPointer(cdp);
	const afterReorder = await readSidebar();
	check(
		"browser sits immediately before agents",
		afterReorder.visible[afterReorder.visible.indexOf("agents") - 1] ===
			"browser",
		JSON.stringify(afterReorder.visible),
	);
	await frame("sidebar-reorder-after");

	/*
	 * 5. THE MENU PATH, with the real right button. `projects` goes to More and
	 * comes back through the same menu, so the two directions are both driven and
	 * the fold's landing is visible when the row arrives.
	 */
	await openRowMenu("projects", { via: "contextmenu" });
	const menuOpen = await readSidebar();
	check(
		"the row menu offers both moves and the region move for a visible row",
		menuOpen.menu?.items.some((item) => item.label === MOVE_TO_MORE) === true &&
			menuOpen.menu.items.some((item) => item.label === "Move up") &&
			menuOpen.menu.items.some((item) => item.label === "Move down"),
		JSON.stringify(menuOpen.menu?.items),
	);
	/*
	 * DESIGN ROUND 2, D10 / QA ROUND 2, Q2-1: the collapsed panel's leading edge
	 * must sit at or outside the strip's trailing edge. Measured here before the
	 * menu is used, so a strip run reports it even though the expanded-only
	 * ellipsis assertions below stop that run later.
	 */
	/*
	 * THE COLUMN IS 56px, and the destinations AREA inside it is narrower than
	 * that (its box is the row's 32px lane), so the edge this must clear is the
	 * strip's own width, not the area's box. 56 is the shipped collapsed width
	 * (`chat-sidebar-layout.ts`), and the design's D10 measurement is against it.
	 * Expanded skips the claim: its panel leaves from the row's own edge outside
	 * the column and is checked by the menu's own frames.
	 */
	const railCollapsed = (menuOpen.area?.box.w ?? 0) <= 64;
	check(
		"the row menu opens clear of the 56px strip when the rail is collapsed",
		menuOpen.menu === null || !railCollapsed || menuOpen.menu.left >= 56,
		JSON.stringify({
			menuLeft: menuOpen.menu?.left,
			stripWidth: 56,
			rail: menuOpen.area?.box,
			collapsed: railCollapsed,
		}),
	);
	/* Recorded, not inferred: a strip run reports the panel's leading edge. */
	note(
		"row menu geometry",
		JSON.stringify({
			menuLeft: menuOpen.menu?.left,
			rail: menuOpen.area?.box,
		}),
	);
	await frame("sidebar-menu-open");
	require("the menu's Move to More item is pressed", await chooseMenuItem(
		MOVE_TO_MORE,
	), JSON.stringify(await menuItemAt(MOVE_TO_MORE)));
	const movedToMore = await waitForSidebar((state) => {
		const row = state.rows.find((each) => each.id === "projects");
		return row !== undefined && row.region === "more";
	}, 10_000);
	check(
		"the menu's Move to More moves projects into the fold, and opens it",
		movedToMore.ok === true &&
			movedToMore.snapshot.moreRow !== null &&
			movedToMore.snapshot.moreRow.expanded === true,
		JSON.stringify({
			more: movedToMore.snapshot?.more,
			moreRow: movedToMore.snapshot?.moreRow,
		}),
	);
	await wait(SETTLE_MS);
	const inMore = await readSidebar();
	check(
		"the projects row is drawn inside the fold, after the rows that were there",
		inMore.more.at(-1) === "projects",
		JSON.stringify(inMore.more),
	);
	/*
	 * And back: the menu inside the fold carries the other direction, and the row
	 * lands at the end of the visible region (design § 6).
	 */
	await openRowMenu("projects", { via: "contextmenu" });
	const moreMenu = await readSidebar();
	check(
		"the menu inside the fold offers Show in sidebar, not Move to More",
		moreMenu.menu?.items.some((item) => item.label === SHOW_IN_SIDEBAR) ===
			true && !moreMenu.menu.items.some((item) => item.label === MOVE_TO_MORE),
		JSON.stringify(moreMenu.menu?.items),
	);
	require("the menu's Show in sidebar item is pressed", await chooseMenuItem(
		SHOW_IN_SIDEBAR,
	), JSON.stringify(await menuItemAt(SHOW_IN_SIDEBAR)));
	const backVisible = await waitForSidebar((state) => {
		const row = state.rows.find((each) => each.id === "projects");
		return row !== undefined && row.region === "visible";
	}, 10_000);
	check(
		"Show in sidebar returns projects to the visible region at its end",
		backVisible.ok === true &&
			backVisible.snapshot.visible.at(-1) === "projects",
		JSON.stringify(backVisible.snapshot?.visible),
	);
	await wait(SETTLE_MS);
	await frame("sidebar-menu-after");

	/*
	 * 6. THE KEYBOARD PATH. Focus the row, Alt+ArrowDown moves it one place, and
	 * Shift+F10 opens the same menu the pointer opens; the menu's own items are
	 * reached with ArrowDown and taken with Enter.
	 */
	const focused = await cdp.evaluate(`(() => {
		const row = document.querySelector('[data-sidebar-row="library"]');
		if (row === null) return { ok: false, reason: 'no row' };
		const button = row.querySelector('button:not([data-sidebar-row-menu])');
		if (button === null) return { ok: false, reason: 'no row button' };
		button.focus();
		return { ok: document.activeElement === button, active: (document.activeElement.textContent || '').trim() };
	})()`);
	const beforeChord = await readSidebar();
	const libraryBefore = beforeChord.visible.indexOf("library");
	check(
		"the library row's button takes focus",
		focused.ok === true && libraryBefore !== -1,
		JSON.stringify({ focused, libraryBefore }),
	);
	await sendKey("ArrowDown", {
		modifiers: 1,
		windowsVirtualKeyCode: 40,
	});
	const chorded = await waitForSidebar(
		(state) => state.visible.indexOf("library") === libraryBefore + 1,
		5_000,
	);
	check(
		"Alt+ArrowDown moves the focused row one place down",
		chorded.ok === true,
		JSON.stringify({
			before: libraryBefore,
			after: chorded.snapshot?.visible.indexOf("library"),
			visible: chorded.snapshot?.visible,
		}),
	);
	await sendKey("F10", {
		code: "F10",
		modifiers: 8,
		windowsVirtualKeyCode: 121,
	});
	const openedByKey = await waitForSidebar(
		(state) => state.menu !== null,
		4_000,
	);
	check(
		"Shift+F10 opens the row menu on the focused row",
		openedByKey.ok === true,
		JSON.stringify({
			menu: openedByKey.snapshot?.menu,
			active: openedByKey.snapshot?.active,
		}),
	);
	/*
	 * The menu is Radix's, so its first item already holds focus; ArrowDown walks
	 * to the region move. The loop reads the focused item's text rather than
	 * counting presses, so an extra item or a disabled boundary item cannot make
	 * the sequence take a different door.
	 */
	let reached = false;
	for (let step = 0; step < 8; step += 1) {
		const state = await readSidebar();
		if (state.active?.inMenu === true && state.active.text === MOVE_TO_MORE) {
			reached = true;
			break;
		}
		await sendKey("ArrowDown", {
			windowsVirtualKeyCode: 40,
		});
		await wait(120);
	}
	check(
		"ArrowDown reaches the menu's Move to More item",
		reached === true,
		JSON.stringify((await readSidebar()).active),
	);
	await sendKey("Enter", { windowsVirtualKeyCode: 13 });
	const keyboardMoved = await waitForSidebar((state) => {
		const row = state.rows.find((each) => each.id === "library");
		return row !== undefined && row.region === "more";
	}, 10_000);
	check(
		"Enter takes Move to More, putting library in the fold",
		keyboardMoved.ok === true &&
			keyboardMoved.snapshot.more.includes("library"),
		JSON.stringify({
			more: keyboardMoved.snapshot?.more,
			visible: keyboardMoved.snapshot?.visible,
		}),
	);
	await wait(SETTLE_MS);
	await frame("sidebar-keyboard-after");
	await sendKey("Escape", { windowsVirtualKeyCode: 27 });
	const closed = await waitForCondition(
		cdp,
		"document.querySelector('[role=\"menu\"]') === null",
		4_000,
	);
	check(
		"Escape leaves no menu open",
		closed.ok === true,
		JSON.stringify(closed),
	);
	/*
	 * AGENT REVIEW ROUND 1, R1-1 / QA ROUND 1, Q1: the menu's `onCloseAutoFocus`
	 * suppresses Radix's own return and hands focus to the moved row's button.
	 * The reviewer read the map as never written; this is the built app's answer.
	 */
	const focusReturned = await readSidebar();
	check(
		"focus returns to the moved row's button after the menu closes",
		focusReturned.active?.inMenu === false &&
			focusReturned.active?.tag === "BUTTON" &&
			(focusReturned.active?.text ?? "").startsWith("Library"),
		JSON.stringify(focusReturned.active),
	);

	/*
	 * 6b. RESET THROUGH THE MENU (agent review round 1, R1-6b). Design § 8 names
	 * reset in the keyboard-only sequence; until now the scene never pressed it.
	 * The layout differs from default here (library was moved into the fold), so
	 * the item is drawn; the default order and the default More contents are both
	 * read back from the DOM, with the fold opened so its rows are drawn.
	 */
	await openRowMenu("projects", { via: "ellipsis" });
	require("the menu offers Reset sidebar layout", await chooseMenuItem(
		RESET_LAYOUT,
	), JSON.stringify(await menuItemAt(RESET_LAYOUT)));
	await wait(SETTLE_MS);
	await ensureFoldOpen();
	const afterReset = await readSidebar();
	check(
		"Reset sidebar layout restores the default visible order",
		JSON.stringify(afterReset.visible) === JSON.stringify(DEFAULT_VISIBLE),
		JSON.stringify({
			visible: afterReset.visible,
			expected: DEFAULT_VISIBLE,
		}),
	);
	/*
	 * READ FROM THE STORE, not from the fold: `mesh` is gated on mesh membership
	 * and this fixture is in no mesh, so the drawn More region is the default
	 * MINUS that row. The reset's claim is about the stored document (all nine
	 * ids, defaults restored); the drawn visible order above is the render claim.
	 */
	const storedAfterReset = await readStoredLayout();
	check(
		"Reset sidebar layout stores the default arrangement, including the gated row",
		JSON.stringify(storedAfterReset?.visible) ===
			JSON.stringify(DEFAULT_VISIBLE) &&
			JSON.stringify(storedAfterReset?.more) === JSON.stringify(DEFAULT_MORE),
		JSON.stringify({ stored: storedAfterReset, more: afterReset.more }),
	);
	await frame("sidebar-reset");

	/*
	 * 7. THE FOLD EMPTIED. Every remaining row is moved out through its own menu
	 * (the ellipsis trigger, the discoverability door), two rows at a time as the
	 * list shrinks; the More control must disappear with the last one rather than
	 * stay as an empty fold.
	 */
	for (;;) {
		const state = await readSidebar();
		if (state.more.length === 0) break;
		const id = state.more[0];
		await openRowMenu(id, { via: "ellipsis" });
		require(`the menu for ${id} offers Show in sidebar`, await chooseMenuItem(
			SHOW_IN_SIDEBAR,
		), JSON.stringify(await menuItemAt(SHOW_IN_SIDEBAR)));
		const moved = await waitForSidebar((current) => {
			const row = current.rows.find((each) => each.id === id);
			return row !== undefined && row.region === "visible";
		}, 10_000);
		require(`${id} returns to the visible region`, moved.ok ===
			true, JSON.stringify({
			visible: moved.snapshot?.visible,
			more: moved.snapshot?.more,
		}));
	}
	const emptyFold = await waitForSidebar(
		(state) =>
			state.moreRow === null &&
			!state.rows.some((row) => row.region === "more"),
		6_000,
	);
	check(
		"the More control is gone once the fold holds nothing",
		emptyFold.ok === true,
		JSON.stringify({
			moreRow: emptyFold.snapshot?.moreRow,
			rows: emptyFold.snapshot?.rows.map((row) => ({
				id: row.id,
				region: row.region,
			})),
		}),
	);
	check(
		"no row is drawn in the more region",
		(emptyFold.snapshot?.more.length ?? -1) === 0,
		JSON.stringify(emptyFold.snapshot?.more),
	);
	await wait(SETTLE_MS);
	await parkPointer(cdp);
	await frame("sidebar-more-empty");

	/*
	 * 8. AIDA FOLDED AWAY. Her row goes to More; the More control comes back, and
	 * whether it carries her attention badge is a fact about a count this scene
	 * cannot make (a completed turn with the conversation unseen). The layout is
	 * captured either way, and the missing fixture is named rather than failed.
	 */
	const beforeAida = await readSidebar();
	require("Aida's row is on the rail before she is folded away", beforeAida.visible.includes(
		"aida",
	), JSON.stringify(beforeAida.visible));
	await openRowMenu("aida", { via: "ellipsis" });
	require("Aida's menu offers Move to More", await chooseMenuItem(
		MOVE_TO_MORE,
	), JSON.stringify(await menuItemAt(MOVE_TO_MORE)));
	const aidaMoved = await waitForSidebar((state) => {
		const row = state.rows.find((each) => each.id === "aida");
		return row !== undefined && row.region === "more";
	}, 10_000);
	require("Aida lands inside the fold, and the More control returns", aidaMoved.ok ===
		true && aidaMoved.snapshot.moreRow !== null, JSON.stringify({
		more: aidaMoved.snapshot?.more,
		moreRow: aidaMoved.snapshot?.moreRow,
	}));
	await wait(SETTLE_MS);
	const aidaInMore = await readSidebar();
	check(
		"the fold is drawn again, with Aida in it",
		aidaInMore.moreRow !== null && aidaInMore.more.includes("aida"),
		JSON.stringify({ moreRow: aidaInMore.moreRow, more: aidaInMore.more }),
	);
	/*
	 * A NOTE, NOT A CHECK (agent review round 1, R1-5; QA round 1, Q3). The old
	 * branch asserted `moreRow.badge === true` only when it was already true, so it
	 * could not fail. This fixture has no attention count (that needs a completed
	 * turn with the conversation unseen), so the scene states what it did not
	 * assert; QA's matrix row 8 is the real proof on that surface.
	 */
	note(
		"Aida-in-More badge",
		`not asserted: this fixture cannot raise a count. More badge drawn: ${aidaInMore.moreRow?.badge === true}; the layout is captured either way, and QA's completed-turn run is the real check.`,
	);
	await frame("sidebar-aida-in-more");

	/*
	 * 9. THE RELOAD. Reading the arrangement before and after `Page.reload` is
	 * the renderer half of design § 7's acceptance test: the read happens once
	 * per mount, so only a backend-stored order can come back. It is NOT a
	 * process restart - QA owns that half - and the output says so.
	 */
	const beforeReload = await ensureFoldOpen();
	const arrangement = {
		visible: beforeReload.visible,
		more: beforeReload.more,
	};
	note(
		"restart scope",
		"renderer reload only (Page.reload); the process-restart half of the acceptance test is QA's",
	);
	const stored = await readStoredLayout();
	const availableIds = new Set([...arrangement.visible, ...arrangement.more]);
	check(
		"the arrangement the reload is about is on the backend's own store",
		stored !== null &&
			JSON.stringify(stored.visible.filter((id) => availableIds.has(id))) ===
				JSON.stringify(arrangement.visible) &&
			JSON.stringify(stored.more.filter((id) => availableIds.has(id))) ===
				JSON.stringify(arrangement.more),
		JSON.stringify({ stored, arrangement }),
	);
	await cdp.send("Page.reload", { ignoreCache: false });
	const back = await waitForCondition(
		cdp,
		'document.querySelectorAll("[data-sidebar-row]").length > 0 && document.querySelector("[data-sidebar-row-menu]") !== null',
		30_000,
	);
	require("the rail mounts again after the renderer reload, with its menus unlocked", back.ok ===
		true, JSON.stringify(back));
	await wait(SETTLE_MS);
	const reloaded = await ensureFoldOpen();
	check(
		"the arrangement survives the reload exactly: same rows, same regions, same order",
		JSON.stringify(reloaded.visible) === JSON.stringify(arrangement.visible) &&
			JSON.stringify(reloaded.more) === JSON.stringify(arrangement.more),
		JSON.stringify({
			before: arrangement,
			after: { visible: reloaded.visible, more: reloaded.more },
		}),
	);
	await frame("sidebar-after-reload");

	note("frames written", `${frames.length} frame(s) under ${framesDir}`);
	return frames;
}

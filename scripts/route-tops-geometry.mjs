// Serialized into the route-tops CDP evaluation. Keep the read in the same
// layout snapshot as the lane and strip probes; no outer-scope dependencies.
export function findLeadingColumn(
	ownRoot,
	box,
	paintedGroundOf,
	columnGrounds,
) {
	if (!ownRoot) return null;
	const route = box(ownRoot);
	if (!route) return null;
	const columnAt = (el) => {
		if (!el) return null;
		const bounds = box(el);
		if (!bounds) return null;
		if (Math.abs(bounds.left - route.left) > 0.5) return null;
		if (bounds.height < route.height - 0.5) return null;
		if (bounds.width >= route.width - 0.5) return null;
		return el;
	};
	const matchColumn = (el) =>
		columnGrounds.includes(paintedGroundOf(el)) ? columnAt(el) : null;
	// Do not short-circuit when ownRoot itself carries a column ground (e.g. a
	// `[data-glass-split]` root painted `bg-surface` with glass off): ownRoot is
	// full-width, so descend into its children and grandchildren to locate the
	// actual leading column (including when an `sr-only` heading precedes it).
	const rootHit = matchColumn(ownRoot);
	if (rootHit) return rootHit;
	for (const child of ownRoot.children) {
		const childHit = matchColumn(child);
		if (childHit) return childHit;
		for (const inner of child.children) {
			const innerHit = matchColumn(inner);
			if (innerHit) return innerHit;
		}
	}
	return null;
}

export function readRouteFrame(document, main, box, roleGround) {
	const outletFrames = Array.from(
		main?.querySelectorAll(
			":scope > [data-workspace-frame-shell] > [data-workspace-frame]",
		) ?? [],
	);
	// Count structural outlet ownership separately from painted body ownership.
	// The latter includes route-owned bodies, but not a hidden Suspense copy.
	const visibleBox = (el) => {
		const bounds = box(el);
		if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null;
		const style = getComputedStyle(el);
		return style.visibility === "visible" &&
			style.display !== "none" &&
			style.display !== "contents" &&
			style.opacity !== "0"
			? bounds
			: null;
	};
	const effectiveFrames = Array.from(
		document.querySelectorAll("[data-workspace-frame]"),
	).filter(visibleBox);
	const frame = effectiveFrames.length === 1 ? effectiveFrames[0] : null;
	const shell = frame?.parentElement?.matches("[data-workspace-frame-shell]")
		? frame.parentElement
		: null;
	const frameOwner =
		!frame || !main?.contains(frame)
			? null
			: outletFrames.includes(frame)
				? "outlet"
				: frame.hasAttribute("data-workspace-split-inset")
					? "split"
					: frame.hasAttribute("data-workspace-inset")
						? "chat"
						: frame.hasAttribute("data-workspace-browser")
							? "browser"
							: null;
	const routeChild = (el) =>
		Array.from(el?.children ?? []).find(
			(child) =>
				!child.hasAttribute("data-chrome-route-band") &&
				getComputedStyle(child).display !== "none",
		) ?? null;
	let route = routeChild(outletFrames[0] ?? main);
	while (route && getComputedStyle(route).display === "contents") {
		route = routeChild(route);
	}
	// The chrome has to be a sibling of the body, not a row found inside it
	// (e.g. Chat's embedded Browser). Read Browser's reserved pending row too.
	const chromeHost = shell?.parentElement ?? null;
	const chrome =
		frameOwner === "chat"
			? chromeHost?.querySelector(":scope > [data-workspace-tabs]")
			: frameOwner === "browser"
				? chromeHost?.querySelector(
						":scope > :is([data-browser-route-chrome], [data-browser-route-pending-chrome])",
					)
				: null;
	const browserPending =
		chrome?.hasAttribute("data-browser-route-pending-chrome") ?? false;
	const chromeTail =
		chromeHost && frameOwner === "browser" && !browserPending
			? Array.from(
					chromeHost.querySelectorAll(
						':scope > div[aria-live="polite"], :scope > [data-tour-tag="browser-error"]',
					),
				)
					.map(visibleBox)
					.filter(Boolean)
			: [];
	const frameStyle = frame ? getComputedStyle(frame) : null;
	const band = main?.querySelector(":scope > [data-chrome-route-band]");
	const fullHeight =
		shell?.hasAttribute("data-workspace-frame-full-height") ?? false;
	const routeFallback =
		(route?.matches(
			"[data-workspace-route-pending], [data-workspace-route-error]",
		) ||
			Boolean(
				frame?.querySelector(
					":scope > [data-workspace-route-pending], :scope > [data-workspace-route-error]",
				),
			)) ??
		false;
	const splitSidebar =
		fullHeight && !routeFallback
			? (Array.from(
					route?.querySelectorAll(
						":scope > [data-glass-region='page-sidebar'], :scope > * > [data-glass-region='page-sidebar']",
					) ?? [],
				).find(visibleBox) ?? null)
			: null;
	// Derive the real split grounds separately from the clearance marker; a
	// missing marker must not make a pane disappear from the expectations.
	// On a full-height split route, `page-sidebar` sits beside the inset shell
	// while `canvas-content` is owned by the inset frame itself.
	const splitPanes = [
		...(splitSidebar ? [splitSidebar] : []),
		...(fullHeight &&
		!routeFallback &&
		frame?.matches("[data-glass-region='canvas-content']")
			? [frame]
			: []),
	].filter(visibleBox);
	// Only the first in-flow child of each ground matters: for scrollable
	// panes this is the scrollport, whose own contents can move independently.
	const safePanes = Array.from(
		main?.querySelectorAll("[data-workspace-safe-content]") ?? [],
	)
		.filter(visibleBox)
		.map((pane) => {
			const first = Array.from(pane.children).find(
				(child) =>
					!["absolute", "fixed"].includes(getComputedStyle(child).position) &&
					visibleBox(child),
			);
			const inFrame = Boolean(frame?.contains(pane));
			return {
				bounds: visibleBox(pane),
				pad: Number.parseFloat(getComputedStyle(pane).paddingTop),
				first: visibleBox(first),
				inFrame,
				role:
					pane.getAttribute("data-glass-region") ??
					(inFrame && !routeFallback
						? (frame?.getAttribute("data-glass-region") ?? null)
						: null),
			};
		});
	const perimeterStyle = shell ? getComputedStyle(shell, "::before") : null;
	const sidebarGlass = document.documentElement.matches(
		'html[data-glass~="sidebar"]',
	);
	const perimeterRole = sidebarGlass ? "--lo-glass-g-surface" : "--lo-surface";
	return {
		route,
		geometry: {
			outletFrames: outletFrames.length,
			effectiveFrames: effectiveFrames.length,
			frameOwner,
			fullHeight,
			splitSidebar: visibleBox(splitSidebar),
			splitRoles: splitPanes.map((pane) =>
				pane.getAttribute("data-glass-region"),
			),
			safePanes,
			routeFallback,
			bandPosition: band ? getComputedStyle(band).position : null,
			frame: visibleBox(frame),
			shell: visibleBox(shell),
			frameRadius: frameStyle?.borderStartStartRadius ?? null,
			frameShadow: frameStyle?.boxShadow ?? null,
			frameBorder: frameStyle?.borderInlineStartWidth ?? null,
			frameClip: frameStyle?.overflow ?? null,
			chrome: visibleBox(chrome),
			chromeTail,
			chromePad: chrome
				? Number.parseFloat(getComputedStyle(chrome).paddingTop)
				: null,
			browserPending,
			perimeter: {
				shapeSupported: CSS.supports(
					"clip-path",
					"shape(from 0 0, line to 100% 100%, close)",
				),
				content: perimeterStyle?.content ?? null,
				display: perimeterStyle?.display ?? null,
				clip: perimeterStyle?.clipPath ?? null,
				paint: perimeterStyle?.backgroundColor ?? null,
				role: perimeterRole,
				rolePaint: roleGround(perimeterRole),
			},
		},
	};
}

/*
 * THE y8 STRIP, as three exported pieces so the scene can be judged against a
 * RECORDED reading instead of only against a live window (QA round 6,
 * 2026-11-23: four false reds that no fixture could reach while this predicate
 * lived inside the driver).
 */
export function stripPanelGrounds(reading) {
	return [
		reading.surfaceGround,
		reading.canvasGround,
		reading.elevatedGround,
		...(reading.glassGrounds ?? []),
	];
}

/*
 * Above a shared inset an outlet body deliberately leaves the strip clear, so a
 * probe there is allowed to report no DOM paint. Only that shape: not a rail,
 * not Chat's or Browser's own strip, and not a full-height route (its split
 * panes start at y0 and cover the strip themselves).
 */
export function stripAboveInset(reading, owner, fullHeight = false) {
	return Boolean(reading.glass) && owner === "outlet" && !fullHeight;
}

/*
 * One probe's verdict. The first rules are the pre-change ones, unchanged.
 *
 * The last rule answers the false red QA round 6 found: the 8px side gutters
 * around a full-height frame are painted by `.workspace-frame-shell::before`,
 * and `document.elementsFromPoint` cannot return a pseudo-element, so the
 * element stack reports no DOM paint at x=innerWidth-4 while the gutter is
 * demonstrably painted (that round's own pixel sampling at x1373-1379, y2-30
 * reads RGBA(38,35,29,168), identical to Chat's gutter, where the pre-change
 * 5e10f2a frames read fully transparent). The pseudo's own paint is already
 * read as `perimeter.paint` - the same reading whose shape/clip/role check
 * passes on those routes - so accept THAT as the paint at a strip probe which
 * sits in the shell's gutter ring and nowhere else.
 *
 * Every part of that is falsifiable, and each is a test: a shell that generates
 * no pseudo, a pseudo it hides, a transparent or unpainted gutter, paint that
 * is not the role's paint or not a panel ground, a probe inside the frame
 * (where no pseudo paints), a probe outside the outlet, and any out-of-flow
 * element covering the gutter (which reports its own bg and is judged by the
 * panel rules). It cannot fire for Chat or Browser: both are `fullHeight:
 * false`, and the ring requires a shell that leaves the frame a horizontal
 * gutter at the strip row.
 */
export function stripProbeAccepted(
	probe,
	reading,
	{ owner, fullHeight = false },
) {
	if (stripAboveInset(reading, owner, fullHeight) && probe.inOutlet)
		return probe.bg === null;
	if (stripPanelGrounds(reading).includes(probe.bg)) return true;
	// Browser's opaque chrome is sunken, not the elevated body under it, so its
	// own ground has to be accepted inside its outlet as well.
	if (
		owner === "browser" &&
		probe.inOutlet &&
		probe.bg === reading.browserChromeGround
	)
		return true;
	const { frame, shell, perimeter } = reading;
	if (!fullHeight || !frame || !shell || !perimeter) return false;
	// A generated `::before` block clipped to shape() paints the shell's surface
	// role through the gutter; without one there is no paint to accept.
	const generated = perimeter.content === '""' && perimeter.display !== "none";
	const painted =
		perimeter.paint !== null &&
		!["transparent", "rgba(0, 0, 0, 0)"].includes(perimeter.paint) &&
		perimeter.paint === perimeter.rolePaint &&
		stripPanelGrounds(reading).includes(perimeter.paint);
	const right = (box) => box.left + box.width;
	const within = (x, start, end) => x >= start - 0.5 && x <= end + 0.5;
	// Inside the shell's own box, outside the rounded frame: the ring the pseudo
	// paints (8px side/top/bottom gutters and 10px corner spandrels).
	const y = probe.y ?? 8;
	const cornerR = 10;
	const outsideCornerArc = (cx, cy) => {
		const dx = probe.x - cx;
		const dy = y - cy;
		return dx * dx + dy * dy > (cornerR - 0.5) * (cornerR - 0.5);
	};
	const inTopLeftSpandrel =
		probe.x < frame.left + cornerR &&
		y < frame.top + cornerR &&
		outsideCornerArc(frame.left + cornerR, frame.top + cornerR);
	const inTopRightSpandrel =
		probe.x > right(frame) - cornerR &&
		y < frame.top + cornerR &&
		outsideCornerArc(right(frame) - cornerR, frame.top + cornerR);
	const ring =
		within(probe.x, shell.left, right(shell)) &&
		(!within(probe.x, frame.left, right(frame)) ||
			y < frame.top - 0.5 ||
			inTopLeftSpandrel ||
			inTopRightSpandrel);
	return (
		probe.bg === null && probe.inOutlet === true && generated && painted && ring
	);
}

export function checkRouteFrame(
	path,
	owner,
	reading,
	check,
	fullHeight = false,
) {
	const { frame, shell, main, band, bandDisplay, chrome, perimeter } = reading;
	const near = (a, b) => Math.abs(a - b) < 0.5; // CDP boxes are rounded to 0.01px.
	const end = (box) => box.top + box.height;
	const visibleBand = band && bandDisplay !== "none" ? band.height : 0;
	check(
		`${path}: ${owner} owns the one visible workspace frame`,
		reading.outletFrames === (owner === "outlet" ? 1 : 0) &&
			reading.effectiveFrames === 1 &&
			reading.frameOwner === owner,
		`outlet ${reading.outletFrames}; visible ${reading.effectiveFrames}; owner ${reading.frameOwner}`,
	);
	check(
		`${path}: only the named split routes use the full-height frame`,
		reading.fullHeight === fullHeight,
		`full height: ${reading.fullHeight}; expected ${fullHeight}`,
	);
	if (fullHeight) {
		const laneHeight =
			reading.laneDisplay !== "none" ? (reading.lane?.height ?? 0) : 0;
		// The existing fullscreen contract reserves one 8px spacing step even
		// without drag chrome. Otherwise the actual drag target is the reference.
		const safeTop = reading.fullscreen ? 8 : Math.max(laneHeight, visibleBand);
		const viewportHeight = reading.viewport?.height ?? end(main);
		const sidebar = reading.splitSidebar ?? null;
		check(
			`${path}: split route reaches y0 and bottom with a full-height sidebar and evenly inset content shell`,
			!!frame &&
				!!shell &&
				!!main &&
				!!reading.route &&
				near(reading.mainPad, 0) &&
				near(reading.route.top, 0) &&
				near(end(reading.route), viewportHeight) &&
				near(shell.top, 0) &&
				near(end(shell), viewportHeight) &&
				(!sidebar ||
					(near(sidebar.top, 0) && near(end(sidebar), viewportHeight))) &&
				(!visibleBand ||
					(reading.bandPosition === "absolute" && near(band.top, 0))),
			JSON.stringify({
				frame,
				shell,
				sidebar,
				main,
				route: reading.route,
				band,
				bandPosition: reading.bandPosition,
			}),
		);
		const paneRoles = reading.safePanes.map((pane) => pane.role);
		const panesOwned = reading.routeFallback
			? paneRoles.length === 1 && paneRoles[0] === null
			: paneRoles.includes("canvas-content") &&
				paneRoles.length === reading.splitRoles.length &&
				paneRoles.every((role, index) => role === reading.splitRoles[index]);
		check(
			`${path}: each split column clears native chrome once inside, before its first in-flow box`,
			!!frame &&
				panesOwned &&
				reading.safePanes.every(({ bounds, pad, first, inFrame }) => {
					const expectedTop = inFrame ? frame.top : 0;
					const expectedEnd = inFrame ? end(frame) : viewportHeight;
					const expectedPad = inFrame ? Math.max(0, safeTop - 8) : safeTop;
					const expectedFirstTop = expectedTop + expectedPad;
					return (
						near(bounds.top, expectedTop) &&
						near(end(bounds), expectedEnd) &&
						near(pad, expectedPad) &&
						!!first &&
						(reading.routeFallback
							? first.top >= expectedFirstTop - 0.5
							: near(first.top, expectedFirstTop))
					);
				}),
			JSON.stringify({
				safeTop,
				safePanes: reading.safePanes,
				splitRoles: reading.splitRoles,
			}),
		);
	} else if (owner === "outlet") {
		check(
			`${path}: the outlet uses one clearance and the route body starts at the frame top`,
			!!frame &&
				!!main &&
				!!reading.route &&
				near(frame.top, main.top + reading.mainPad + visibleBand) &&
				near(reading.route.top, frame.top),
			JSON.stringify({
				frame,
				main,
				route: reading.route,
				pad: reading.mainPad,
				visibleBand,
			}),
		);
	} else {
		// Integrated Chat moves the tabs into the OS clearance; fullscreen/native
		// leaves the shell pad above them. Browser's chrome starts at the main top
		// and spends the shell pad inside its own row (or pending placeholder).
		const chromeTop =
			main &&
			main.top +
				(owner === "chat" &&
				!(reading.mode === "integrated" && !reading.fullscreen)
					? reading.mainPad
					: 0);
		let chromeEnd = chrome ? end(chrome) : null;
		let rowsAbut = true;
		for (const row of reading.chromeTail) {
			rowsAbut &&= chromeEnd !== null && near(row.top, chromeEnd);
			chromeEnd = end(row);
		}
		check(
			`${path}: one clearance with route chrome outside and directly above its body frame`,
			!!main &&
				!!chrome &&
				!!frame &&
				band === null &&
				near(chrome.top, chromeTop) &&
				rowsAbut &&
				near(frame.top, chromeEnd) &&
				end(chrome) >= main.top + reading.mainPad - 0.5 &&
				(owner !== "browser" ||
					reading.browserPending ||
					near(reading.chromePad, reading.mainPad)),
			JSON.stringify({
				frame,
				main,
				chrome,
				chromeTop,
				chromeEnd,
				chromeTail: reading.chromeTail,
				pad: reading.mainPad,
				chromePad: reading.chromePad,
				band,
			}),
		);
	}
	const sidebar = fullHeight ? (reading.splitSidebar ?? null) : null;
	const expectedShellLeft = sidebar ? sidebar.left + sidebar.width : main?.left;
	const expectedShellWidth = sidebar ? main.width - sidebar.width : main?.width;
	check(
		`${path}: the frame keeps 8px side and bottom gutters${fullHeight ? " and an 8px top gutter" : " and no extra top gap"}`,
		!!frame &&
			!!shell &&
			!!main &&
			near(shell.left, expectedShellLeft) &&
			near(shell.width, expectedShellWidth) &&
			near(end(shell), end(main)) &&
			near(frame.top - shell.top, fullHeight ? 8 : 0) &&
			near(frame.left - shell.left, 8) &&
			near(shell.left + shell.width - frame.left - frame.width, 8) &&
			near(end(shell) - end(frame), 8),
		JSON.stringify({ frame, shell, sidebar, main }),
	);
	check(
		`${path}: 10px clipped corners without an edge or shadow`,
		reading.frameRadius === "10px" &&
			reading.frameClip === "clip" &&
			reading.frameBorder === "0px" &&
			reading.frameShadow === "none",
		`radius ${reading.frameRadius}, overflow ${reading.frameClip}, border ${reading.frameBorder}, shadow ${reading.frameShadow}`,
	);
	// This is computed CSS only: shape/role readback does not sample the PNG
	// or tell us what a native material composites behind translucent paint.
	const generated = perimeter.content === '""' && perimeter.display !== "none";
	const painted =
		perimeter.paint !== null &&
		!["transparent", "rgba(0, 0, 0, 0)"].includes(perimeter.paint) &&
		perimeter.paint === perimeter.rolePaint;
	check(
		`${path}: computed gutter paint follows shape() support and the shell surface role`,
		!!shell &&
			(perimeter.shapeSupported
				? generated && perimeter.clip?.startsWith("shape(") && painted
				: ["none", "normal"].includes(perimeter.content) &&
					perimeter.clip === "none"),
		JSON.stringify(perimeter),
		JSON.stringify(perimeter),
	);
}

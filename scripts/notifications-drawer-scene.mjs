/**
 * Drawer remediation matrix, called ONLY by notifications-app-scene on its
 * sanctioned GitHub-hosted macOS foreground desktop. This is not a second browser
 * or a local launcher. Its proxy forwards to the scene's real isolated core; fault
 * switches delay/refuse transport, never manufacture a successful write receipt.
 * SSE passes through unchanged. The ask lane may wrap this URL in its own proxy.
 */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { join } from "node:path";

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* Three digits in any of the three digit families the shipped locales print: Latin,
 * Arabic-Indic and Extended Arabic-Indic (Urdu). Module level so the poll below does
 * not rebuild the literal on every tick. */
const THREE_DIGITS = /[0-9\u0660-\u0669\u06F0-\u06F9]{3}/;
async function until(check, label, ms = 30_000) {
	const deadline = Date.now() + ms;
	let last;
	do {
		last = await check();
		if (last) return last;
		await pause(100);
	} while (Date.now() < deadline);
	throw new Error(`${label}: timed out (${JSON.stringify(last)})`);
}

/** Faults are opt-in and session-scoped; the original scene's negatives stay real. */
export async function prepareDrawerRemediation({
	base,
	config,
	token,
	coreStore,
}) {
	const created = await fetch(`${base}/v1/desktop/sessions`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ request_id: crypto.randomUUID(), cwd: config }),
	});
	assert.ok(created.ok, `drawer session create status ${created.status}`);
	const body = await created.json();
	const session = body.result?.session_id;
	assert.equal(
		typeof session,
		"string",
		"core must return the actual created session id",
	);
	const seedRows = JSON.parse(
		coreStore(
			config,
			[
				"import json",
				"from local_operator.notifications.store import NotificationStore",
				`store = NotificationStore(${JSON.stringify(config)})`,
				"rows = []",
				"for i in range(12):",
				`    out = store.notify(${JSON.stringify(session)}, key=f'drawer-{i}', title=f'Drawer update {i}: detailed verification of the notification read-state receipt and its history', body_md='Synthetic CI notification; no model turn.', priority='normal')`,
				"    rows.append({'id':out.item_id,'revision':out.revision})",
				"store.apply('read', ids=[(row['id'],row['revision']) for row in rows[:2]])",
				"print(json.dumps(rows))",
			].join("\n"),
		),
	);
	const ids = new Set(seedRows.map((row) => row.id));
	const state = {
		enabled: false,
		holdReads: false,
		holdPatch: false,
		failReads: false,
		failNextPatch: false,
		patches: [],
		releases: [],
	};
	const server = createServer(async (req, res) => {
		try {
			const url = new URL(req.url, base);
			const chunks = [];
			for await (const chunk of req) chunks.push(chunk);
			const bytes = Buffer.concat(chunks);
			const isList =
				req.method === "GET" &&
				url.pathname === "/v1/desktop/notifications" &&
				url.searchParams.get("session_id") === session;
			let payload;
			if (
				req.method === "PATCH" &&
				url.pathname === "/v1/desktop/notifications"
			) {
				try {
					payload = JSON.parse(bytes.toString());
				} catch {
					/* Forward malformed input untouched. */
				}
			}
			const ownPatch =
				state.enabled &&
				payload &&
				(payload.ids?.some((item) => ids.has(item.id)) ||
					payload.target?.items?.some((item) => ids.has(item.id)) ||
					payload.session_id === session);
			if (state.enabled && isList && state.failReads) {
				res.writeHead(503, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ detail: "CI drawer transport unavailable" }));
				return;
			}
			if (
				(state.enabled && isList && state.holdReads) ||
				(ownPatch && state.holdPatch)
			)
				await new Promise((resolve) => state.releases.push(resolve));
			if (ownPatch && state.failNextPatch) {
				state.failNextPatch = false;
				res.writeHead(409, { "Content-Type": "application/json" });
				res.end(
					JSON.stringify({
						detail: "CI refused inverse before forwarding; no mutation",
					}),
				);
				return;
			}
			const upstream = httpRequest(
				url,
				{ method: req.method, headers: { ...req.headers, host: url.host } },
				(answer) => {
					res.writeHead(answer.statusCode, answer.headers);
					if (ownPatch) {
						const parts = [];
						answer.on("data", (part) => parts.push(part));
						answer.on("end", () => {
							const raw = Buffer.concat(parts).toString();
							let receipt;
							try {
								receipt = JSON.parse(raw);
							} catch {
								receipt = { unparsed: true };
							}
							state.patches.push({
								status: answer.statusCode,
								request: payload,
								receipt,
							});
						});
					}
					answer.pipe(res);
				},
			);
			res.once("close", () => upstream.destroy());
			upstream.on("error", () => {
				if (!res.headersSent) res.writeHead(502);
				res.end();
			});
			res.on("close", () => upstream.destroy());
			upstream.end(bytes);
		} catch (error) {
			if (!res.headersSent) res.writeHead(502);
			res.end(String(error.message));
		}
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	return {
		session,
		seedRows,
		state,
		apiUrl: `http://127.0.0.1:${server.address().port}`,
		release() {
			state.holdReads = false;
			state.holdPatch = false;
			for (const release of state.releases.splice(0)) release();
		},
		close() {
			state.enabled = false;
			for (const release of state.releases.splice(0)) release();
			server.closeAllConnections();
			server.close();
		},
		readFromOtherSurface(row) {
			return coreStore(
				config,
				[
					"from local_operator.notifications.store import NotificationStore",
					`s=NotificationStore(${JSON.stringify(config)})`,
					`s.apply('read', ids=[(${JSON.stringify(row.id)}, ${row.revision})])`,
				].join("\n"),
			);
		},
		rows() {
			return JSON.parse(
				coreStore(
					config,
					[
						"import json",
						"from local_operator.notifications.store import NotificationStore",
						`s=NotificationStore(${JSON.stringify(config)})`,
						`print(json.dumps([s.get(i) for i in ${JSON.stringify(seedRows.map((r) => r.id))}], default=str))`,
					].join("\n"),
				),
			);
		},
		/*
		 * THE NARROW STEP'S THREE-DIGIT COUNT (design round 1, D7). The seeded twelve
		 * rows cannot reach three digits without holding every write for 95 presses.
		 * Written through the pinned core's own store - a real row in the same table a
		 * forwarding write would reach, never a manufactured receipt - so the badge is
		 * counting rows that exist.
		 *
		 * WHY ONE CONVERSATION AND NOT SEVERAL. This count is the DRAWER's own tab
		 * label, and that label is one conversation's unread walk
		 * (`useSessionUnreadUpdates` -> `readSessionUnreadCount(sessionId)` in
		 * notifications-api.ts): rows raised on other conversations move the fleet
		 * reel and the page pill, never this number. Measured against the pinned
		 * store: 42 rows on three other conversations left this conversation's walk
		 * at 122. So a fleet-wide seed cannot satisfy this assertion, and the three
		 * digits have to form in the conversation under test.
		 *
		 * WHY HOURLY BATCHES. The store refuses a 31st NEW item from one conversation
		 * in a rolling hour (`NEW_ITEMS_PER_HOUR`, store.py:101) - a product guard
		 * that is honoured here, never raised or bypassed. A real conversation does
		 * not reach 100 + unread in one hour: it reaches them over hours. So the
		 * backlog is stamped in hourly batches (`now` is the store's own public
		 * argument for the row's time), oldest first, each batch under what the guard
		 * still allows: a burst of 31 at one stamp is still refused, and so is a
		 * batch that would overfill an hour on top of the rows this conversation
		 * already raised.
		 *
		 * Oldest first because the guard's window is `created_at > stamp - 1h` with
		 * no upper edge: a backdated batch also counts rows raised LATER, so writing
		 * the newer batches first would leave the older ones no allowance at all.
		 * Batches are more than an hour apart so a batch's own rows fall outside the
		 * next batch's window, and keys stay distinct within the conversation so no
		 * row collapses into an earlier one.
		 */
		seedUnread(count) {
			/* Under the 30/hour cap with room for the twelve rows this conversation
			 * already raised inside the hour. */
			const batchSize = 16;
			const spacing = 60 * 60 * 1000 + 120 * 1000;
			const batches = Math.ceil(count / batchSize);
			return JSON.parse(
				coreStore(
					config,
					[
						"import json, time",
						"from local_operator.notifications.store import NotificationStore",
						`store = NotificationStore(${JSON.stringify(config)})`,
						`batch_size = ${batchSize}`,
						`batches = ${batches}`,
						`spacing = ${spacing}`,
						"start = int(time.time() * 1000)",
						"seeded = 0",
						"for batch in range(batches, 0, -1):",
						"    stamp = start - batch * spacing",
						"    for index in range(batch_size):",
						`        store.notify(${JSON.stringify(session)}, key=f"backlog-{batch}-{index}", title=f"Narrow width update {batch}.{index}", body_md="Synthetic CI notification; no model turn.", priority="normal", now=stamp)`,
						"        seeded += 1",
						"print(json.dumps({",
						'    "seeded": seeded,',
						'    "batches": batches,',
						'    "batchSize": batch_size,',
						'    "spacingMs": spacing,',
						"}))",
					].join("\n"),
				),
			);
		},
		revise(row) {
			return coreStore(
				config,
				[
					"from local_operator.notifications.store import NotificationStore",
					`s=NotificationStore(${JSON.stringify(config)})`,
					`r=s.get(${JSON.stringify(row.id)})`,
					`s.notify(${JSON.stringify(session)},key=r['key'],title='New revision: still needs reading',body_md='Concurrent keyed update',priority='normal')`,
				].join("\n"),
			);
		},
	};
}

/**
 * Where a control can actually be hit, and why it cannot when it cannot.
 *
 * `click()` used to click the element's CENTRE and read "not the top hit at the
 * centre" as "not there", so a control that is drawn, present and reachable but
 * partly under another layer timed out with a bare `null`. That is not evidence
 * about the product: the narrow 200 %/RTL step died on it and wrote none of its
 * frames (agent review round 1, R1-1; design round 1, D7). This probe scrolls the
 * control into view and samples points of its own box - centre first, then inset
 * points inside the viewport - and answers the first point the element really
 * owns. When it owns none, the answer carries the MEASUREMENT instead: the rect,
 * the CSS viewport, and the element that is actually on top.
 */
const hittablePoint = (selector) => `(()=>{
	const e=document.querySelector(${JSON.stringify(selector)});
	if(!e) return {present:false};
	e.scrollIntoView({block:'nearest',inline:'nearest'});
	const r=e.getBoundingClientRect();
	const vw=window.innerWidth,vh=window.innerHeight;
	const round=(n)=>Math.round(n*10)/10;
	const rect={x:round(r.x),y:round(r.y),width:round(r.width),height:round(r.height)};
	const viewport={width:vw,height:vh};
	const left=Math.max(r.left,0),right=Math.min(r.right,vw);
	const top=Math.max(r.top,0),bottom=Math.min(r.bottom,vh);
	const describe=(node)=>node?{tag:node.tagName,cls:String(node.className??'').slice(0,140),data:Object.assign({},node.dataset)}:null;
	if(r.width<=0||r.height<=0) return {present:true,rect,viewport,reason:'zero-sized'};
	if(right-left<=0||bottom-top<=0)
		return {present:true,rect,viewport,reason:'outside the viewport',onTop:describe(document.elementFromPoint(vw/2,vh/2))};
	const xs=[(left+right)/2,left+(right-left)*0.35,left+(right-left)*0.65];
	const ys=[(top+bottom)/2,top+(bottom-top)*0.35,top+(bottom-top)*0.65];
	for(const y of ys) for(const x of xs){
		const hit=document.elementFromPoint(x,y);
		if(hit&&(e===hit||e.contains(hit))) return {present:true,x,y,rect,viewport};
	}
	return {present:true,rect,viewport,reason:'another element is on top',onTop:describe(document.elementFromPoint((left+right)/2,(top+bottom)/2))};
})()`;

async function click(cdp, selector) {
	let box;
	try {
		box = await until(async () => {
			const probed = await cdp.evaluate(hittablePoint(selector));
			return probed && typeof probed.x === "number"
				? { x: probed.x, y: probed.y }
				: null;
		}, `click ${selector}`);
	} catch {
		/* The measurement, not a bare timeout - the thing R1-1 needed and did not get. */
		const diagnosis = await cdp
			.evaluate(hittablePoint(selector))
			.catch(() => null);
		throw new Error(
			`click ${selector}: no point of the control is hittable - ${JSON.stringify(diagnosis)}`,
		);
	}
	await cdp.send("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		button: "none",
		x: box.x,
		y: box.y,
	});
	await pause(250); // The row action is revealed by this real hover, not activated while opacity=0.
	for (const type of ["mousePressed", "mouseReleased"])
		await cdp.send("Input.dispatchMouseEvent", {
			type,
			button: type === "mouseMoved" ? "none" : "left",
			clickCount: 1,
			...box,
		});
}
const stateOf = (cdp) =>
	cdp.evaluate(`(()=>({
 rows:[...document.querySelectorAll('[data-drawer-update]')].map(e=>({id:e.dataset.drawerUpdate,unread:e.hasAttribute('data-unread')})),
 unread:document.querySelector('[data-drawer-read-view="unread"]')?.textContent,
 selected:document.querySelector('[data-drawer-read-view][aria-checked="true"]')?.dataset.drawerReadView,
 badge:document.querySelector('a[href="#/notifications"]')?.textContent,
 empty:document.querySelector('[data-drawer-empty]')?.textContent,
 focus:document.activeElement?.outerHTML.slice(0,250),
 focusedRow:document.activeElement?.closest('[data-drawer-update]')?.dataset.drawerUpdate,
 focusedAction:document.activeElement?.dataset.rowAction,
 theme:document.documentElement.dataset.theme,dir:document.documentElement.dir,
 viewport:{width:window.innerWidth,height:window.innerHeight},
 glass:document.documentElement.dataset.glass,
 bounds:[...document.querySelectorAll('[data-drawer-read-view], [data-drawer-updates], [data-ask-drawer]')].map(e=>{const r=e.getBoundingClientRect();return {selector:e.dataset.drawerReadView??e.dataset.askDrawer??'updates',x:r.x,y:r.y,width:r.width,height:r.height,scrollWidth:e.scrollWidth,clientWidth:e.clientWidth}})
}))()`);

/** Uses actual UI actions, real foreground guard, real HTTP receipts and store readback. */
export async function runDrawerRemediationScene({
	cdp,
	nodeCdp,
	fixture,
	screenshot,
	out,
}) {
	const receipt = { matrix: [], frames: [], transport: fixture.state.patches };
	/* One owner for the window geometry, so the zoom a step says it used is the one
	 * the receipt's own viewport measurement proves. */
	const zoomTo = (factor) =>
		nodeCdp.evaluate(
			`(()=>{const e=process.mainModule.require('electron');const w=e.BrowserWindow.getAllWindows()[0];w.setContentSize(1000,900);w.webContents.setZoomFactor(${factor});return {zoom:w.webContents.getZoomFactor(),size:w.getContentSize()}})()`,
		);
	const capture = async (label) => {
		const state = await stateOf(cdp);
		const frame = await screenshot(cdp, `drawer-${label}`);
		receipt.frames.push({ label, state, ...frame });
		return state;
	};
	const ready = () =>
		until(
			() =>
				cdp.evaluate(
					`Boolean(document.querySelector('[data-drawer-read-view]'))`,
				),
			"drawer controls",
		);
	const open = async () => {
		await cdp.evaluate(
			`(location.hash=${JSON.stringify(`#/chat/${fixture.session}`)})`,
		);
		await until(
			() =>
				cdp.evaluate(
					`Boolean(document.querySelector('[data-tour-tag="ask-pane-trigger"]'))`,
				),
			"conversation rail",
		);
		if (
			!(await cdp.evaluate(
				`Boolean(document.querySelector('[data-drawer-tab="updates"]'))`,
			))
		)
			await click(cdp, '[data-tour-tag="ask-pane-trigger"]');
		await click(cdp, '[data-drawer-tab="updates"]');
	};
	try {
		fixture.state.enabled = true;
		await open();
		await ready();
		for (const theme of ["localOperatorDark", "localOperatorLight"]) {
			// Reload the isolated profile through the SAME persistence seam as Settings;
			// editing CSS attributes alone would not exercise the app's theme providers.
			await cdp.evaluate(
				`(()=>{const k='ui-preferences-storage';const p=JSON.parse(localStorage.getItem(k)||'{"state":{},"version":0}');p.state.themeName=${JSON.stringify(theme)};localStorage.setItem(k,JSON.stringify(p));location.reload();return true})()`,
			);
			await pause(1500);
			await open();
			await ready();
			const before = await capture(`${theme}-populated`);
			assert.equal(
				before.theme,
				theme,
				"frame palette must be the app's actual theme",
			);
			assert.ok(before.rows.length > 0, "populated drawer precondition");
			const id = before.rows[0].id;
			fixture.state.holdPatch = true;
			await click(cdp, `[data-drawer-update="${id}"] [data-row-action="read"]`);
			await until(
				async () => !(await stateOf(cdp)).rows.some((row) => row.id === id),
				"first click optimistic removal",
				3000,
			);
			const firstClick = await capture(`${theme}-first-click`);
			/*
			 * D4: THE READ SEGMENT MUST NOT MOVE WHEN THE COUNT LOSES A DIGIT. The badge
			 * inside Unread widened its own segment by a digit as the count left two
			 * digits, pushing Read 7.7 px sideways on the first click of a triage run -
			 * the click this frame is of. Measured, not asserted from the class list.
			 */
			const readBefore = before.bounds.find((box) => box.selector === "read");
			const readAfter = firstClick.bounds.find(
				(box) => box.selector === "read",
			);
			assert.ok(
				readBefore && readAfter,
				"both frames must record the Read segment",
			);
			assert.ok(
				Math.abs(readBefore.x - readAfter.x) <= 0.5,
				`the Read segment held its x on the click: ${readBefore.x} -> ${readAfter.x}`,
			);
			/* Read the actual state fields: `focused` never existed, so the earlier
			 * assertion failed even when Chromium correctly focused the next row.
			 * Keep the row identity and action explicit: tab/other-action focus is a
			 * failed handoff, not evidence that some element retained focus. */
			assert.equal(
				firstClick.focusedRow,
				firstClick.rows[0].id,
				"removing the focused row must hand keyboard position to a remaining row",
			);
			assert.equal(
				firstClick.focusedAction,
				"read",
				"focus must land on the remaining row's read control, not another target",
			);
			fixture.release();
			await until(
				() =>
					fixture.rows().find((row) => row.id === id)?.read_rev >=
					fixture.rows().find((row) => row.id === id)?.revision,
				"store read receipt",
			);
			await pause(350);
			await capture(`${theme}-settled-read-undo`);
			await click(cdp, '[data-drawer-read-view="read"]');
			await until(
				async () => (await stateOf(cdp)).rows.some((row) => row.id === id),
				"Read history contains changed row",
			);
			await capture(`${theme}-history`);
			await click(cdp, `[data-drawer-update="${id}"] [data-row-action="read"]`);
			await until(
				async () => !(await stateOf(cdp)).rows.some((row) => row.id === id),
				"mark unread removes Read row",
			);
			await click(cdp, '[data-drawer-read-view="unread"]');
			receipt.matrix.push({
				surface: theme,
				command: "row read then unread",
				result: "PASS",
				store: fixture.rows().find((row) => row.id === id),
			});
		}
		// Concurrent external read while a UI dismiss is in flight. The producer
		// uses core's real store; only the failed dismiss is a native user gesture.
		const concurrent = fixture.seedRows[2];
		fixture.state.holdPatch = true;
		await click(
			cdp,
			`[data-drawer-update="${concurrent.id}"] [data-row-action="dismiss"]`,
		);
		await until(
			async () =>
				!(await stateOf(cdp)).rows.some((row) => row.id === concurrent.id),
			"optimistic dismiss",
		);
		fixture.readFromOtherSurface(concurrent);
		fixture.state.failNextPatch = true;
		fixture.release();
		await pause(500);
		await click(cdp, '[data-drawer-read-view="read"]');
		await until(
			async () =>
				(await stateOf(cdp)).rows.some((row) => row.id === concurrent.id),
			"failed dismiss retains independently read history",
		);
		const concurrentRow = fixture
			.rows()
			.find((row) => row.id === concurrent.id);
		assert.ok(concurrentRow.read_rev >= concurrentRow.revision);
		assert.equal(concurrentRow.dismissed_at, null);
		await capture("concurrent-read-dismiss-refusal");
		receipt.matrix.push({
			surface: "concurrent external read / rejected native dismiss",
			result: "PASS",
			store: concurrentRow,
		});
		await click(cdp, '[data-drawer-read-view="unread"]');
		// Stale content revision while list reads are delayed: the PATCH is real and
		// must accept the other rows while refusing this one, not invent a compact tally.
		const before = await stateOf(cdp);
		const stale = fixture.seedRows.find((row) => row.id === before.rows[0].id);
		fixture.state.holdReads = true;
		fixture.revise(stale);
		const prior = fixture.state.patches.length;
		await click(cdp, "[data-drawer-mark-all-read]");
		await until(
			() => fixture.state.patches.length > prior,
			"partial HTTP receipt",
		);
		const partial = fixture.state.patches.at(-1);
		const result = partial.receipt.result;
		assert.ok(
			result?.skipped?.some((row) => row.id === stale.id),
			"real stale token must be refused",
		);
		await until(
			async () => (await stateOf(cdp)).rows.some((row) => row.id === stale.id),
			"skipped row restored",
		);
		await capture("partial-receipt-first");
		await pause(350);
		await capture("partial-receipt-settled");
		fixture.release();
		receipt.matrix.push({
			surface: "partial receipt",
			result: "PASS",
			http: partial,
		});
		// The receipt's real Undo button is reached with trusted input. Refuse the
		// inverse once at transport, then retry the same frozen tokens through the toast.
		fixture.state.failNextPatch = true;
		await click(cdp, "[data-sonner-toast] [data-button]");
		await until(
			() =>
				cdp.evaluate(
					`Boolean(document.querySelector('[data-sonner-toast][data-type="error"] [data-button]'))`,
				),
			"Undo error with retry",
		);
		await capture("undo-refused-retry");
		await click(cdp, '[data-sonner-toast][data-type="error"] [data-button]');
		await until(
			async () => (await stateOf(cdp)).rows.length > 1,
			"retry restored accepted rows",
		);
		receipt.matrix.push({ surface: "Undo refusal and retry", result: "PASS" });
		// Radio arrows and focused-row removal: dispatch keys, don't call a handler.
		await click(cdp, '[data-drawer-read-view="unread"]');
		await cdp.send("Input.dispatchKeyEvent", {
			type: "keyDown",
			key: "ArrowRight",
			code: "ArrowRight",
			windowsVirtualKeyCode: 39,
		});
		await cdp.send("Input.dispatchKeyEvent", {
			type: "keyUp",
			key: "ArrowRight",
			code: "ArrowRight",
			windowsVirtualKeyCode: 39,
		});
		assert.equal((await stateOf(cdp)).selected, "read");
		await click(cdp, '[data-drawer-read-view="unread"]');
		await click(cdp, "[data-drawer-mark-all-read]");
		await until(
			async () => Boolean((await stateOf(cdp)).empty),
			"last unread empty state",
		);
		await capture("empty");
		// A cold page-one read proves loading/error, rather than photographing stale
		// populated content and naming it loading. Only this session's GET is faulted.
		fixture.state.holdReads = true;
		await cdp.evaluate("location.reload()");
		await pause(1500);
		await open();
		await until(
			() =>
				cdp.evaluate(
					`Boolean(document.querySelector('[data-drawer-loading]'))`,
				),
			"loading state",
		);
		await capture("loading");
		fixture.state.failReads = true;
		fixture.release();
		await pause(1000);
		await cdp.evaluate("location.reload()");
		await pause(1500);
		await open();
		await until(
			() =>
				cdp.evaluate(
					`Boolean(document.querySelector('[data-drawer-load-error]'))`,
				),
			"error state",
			45000,
		);
		await capture("error");
		fixture.state.failReads = false;
		await click(cdp, "[data-drawer-load-error] button");
		await ready();
		// Real zoom and persisted backend locale; no fake RTL DOM attribute. On an
		// unsupported pinned core this FAILS explicitly, never claims a rendered axis.
		const locale = await cdp.evaluate(
			`window.api.desktop.request({op:'settings.edit',key:'language',value:'ur'})`,
		);
		assert.ok(
			locale.status >= 200 && locale.status < 300,
			"core must accept Urdu setting for RTL evidence",
		);
		/*
		 * A THREE-DIGIT COUNT AT THIS WIDTH (design round 1, D7). Seeded through the
		 * fixture's own window - its proxy is still attached and the app just answered
		 * a read - so the badge the frame shows is the server's count of real rows.
		 * The backlog is dated across hours (see `seedUnread`): the store's hourly
		 * new-item cap is the product's own, and a conversation that carries three
		 * digits of unread reached them over hours, not in one burst.
		 */
		const backlog = fixture.seedUnread(100);
		assert.ok(
			backlog.seeded >= 100,
			`the drawer's conversation must carry at least 100 backlog rows: ${JSON.stringify(backlog)}`,
		);
		/*
		 * OPEN AT 1x, THEN ZOOM THE OPEN PANE.
		 *
		 * The reload used to happen AFTER the 2x zoom, so the reopen had to click a
		 * control inside a 500x450 CSS-px window the rig could not reach - and the step
		 * then wrote no frame at all (agent review round 1, R1-1; design round 1, D7).
		 * Page zoom only shrinks the viewport in CSS pixels: the layout the frames show
		 * is the same layout, and the reachability probe below still measures whether
		 * the strip's own control is hittable at 200 % in RTL. That is the product
		 * claim; "the app's post-reload reopen works at 2x" is not this pane's to
		 * prove, and asking for it here cost the entire narrow axis.
		 */
		await cdp.evaluate("location.reload()");
		await pause(1500);
		await open();
		await ready();
		await zoomTo(2);
		/*
		 * THE DISCRIMINATING MEASUREMENT, IN THE RECEIPT. "Drawn" and "hittable" are
		 * different claims and the failing step conflated them: this names the point it
		 * can hit, or the element that is on top when it cannot.
		 */
		const hit = await cdp.evaluate(
			`(${hittablePoint('[data-drawer-tab="updates"]')})`,
		);
		const hittable = typeof hit.x === "number";
		receipt.matrix.push({
			surface: "narrow 200% RTL reachability",
			result: hittable ? "PASS" : "FAIL",
			measurement: {
				viewport: hit.viewport,
				rect: hit.rect,
				reason: hit.reason,
				onTop: hit.onTop,
				point: hittable ? { x: hit.x, y: hit.y } : null,
			},
		});
		assert.ok(
			hittable,
			`the Updates tab must stay hittable at 200% in RTL: ${JSON.stringify(hit)}`,
		);
		await until(
			async () => THREE_DIGITS.test((await stateOf(cdp)).unread ?? ""),
			"three-digit unread count",
			60_000,
		);
		await click(cdp, '[data-drawer-read-view="read"]');
		await pause(350);
		const narrow = await capture("narrow-200-rtl-history");
		assert.equal(narrow.dir, "rtl");
		assert.ok(
			narrow.viewport.width <= 520 && narrow.viewport.height <= 470,
			`the narrow frame must be rendered at the zoomed viewport, got ${JSON.stringify(narrow.viewport)}`,
		);
		assert.ok(
			narrow.bounds
				.filter((box) => box.selector === "unread" || box.selector === "read")
				.every((box) => box.scrollWidth <= box.clientWidth + 1),
			"radio labels/counts clipped",
		);
		assert.match(
			narrow.unread ?? "",
			THREE_DIGITS,
			`the narrow frame must carry a three-digit count: ${narrow.unread}`,
		);
		receipt.matrix.push({
			surface: "narrow 200% RTL",
			result: "PASS",
			geometry: narrow.bounds,
			count: narrow.unread,
			/* How the count reached three digits, so the artifact answers it. */
			backlog,
		});
		/* Back to 1x for the reload that repaints through the app's own theme
		 * persistence, then the same zoom-the-open-pane order as above. */
		await zoomTo(1);
		await cdp.evaluate(
			`(()=>{const key='ui-preferences-storage';const prefs=JSON.parse(localStorage.getItem(key));prefs.state.themeName='localOperatorLight';localStorage.setItem(key,JSON.stringify(prefs));location.reload();return true})()`,
		);
		await pause(1500);
		await open();
		await ready();
		await zoomTo(2);
		await click(cdp, '[data-drawer-read-view="read"]');
		await capture("light-narrow-200-rtl-history");
		receipt.result = "PASS";
	} catch (error) {
		receipt.result = "FAIL";
		receipt.error = String(error.stack ?? error);
		/* A red step must leave pixels and geometry behind: the frames this lane could
		 * not reach are why the round after R1-1 had nothing to read. */
		try {
			receipt.failureState = await stateOf(cdp);
			receipt.failureFrame = await screenshot(cdp, "drawer-failure-state");
		} catch {}
		throw error;
	} finally {
		fixture.release();
		fixture.state.failReads = false;
		fixture.state.enabled = false;
		writeFileSync(
			join(out, "drawer-remediation.json"),
			JSON.stringify(receipt, null, 2),
		);
		// Leave the original off-screen/blur negatives on their original reel and scale.
		await cdp
			.evaluate(
				`window.api.desktop.request({op:'settings.edit',key:'language',value:'en'})`,
			)
			.catch(() => {});
		await nodeCdp
			.evaluate(
				`(()=>{const e=process.mainModule.require('electron');const w=e.BrowserWindow.getAllWindows()[0];w.webContents.setZoomFactor(1);w.setContentSize(1380,900);return true})()`,
			)
			.catch(() => {});
		await cdp.evaluate(`(location.hash='#/notifications')`).catch(() => {});
	}
}

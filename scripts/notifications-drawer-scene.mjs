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

async function click(cdp, selector) {
	const box = await until(
		() =>
			cdp.evaluate(
				`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null; e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;const top=document.elementFromPoint(x,y);return r.width&&r.height&&e.contains(top)?{x,y}:null})()`,
			),
		`click ${selector}`,
	);
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
		await nodeCdp.evaluate(
			`(()=>{const e=process.mainModule.require('electron');const w=e.BrowserWindow.getAllWindows()[0];w.setContentSize(1000,900);w.webContents.setZoomFactor(2);return {zoom:w.webContents.getZoomFactor(),size:w.getContentSize()}})()`,
		);
		await cdp.evaluate("location.reload()");
		await pause(1500);
		await open();
		await ready();
		await click(cdp, '[data-drawer-read-view="read"]');
		await pause(350);
		const narrow = await capture("narrow-200-rtl-history");
		assert.equal(narrow.dir, "rtl");
		assert.ok(
			narrow.bounds
				.filter((box) => box.selector === "unread" || box.selector === "read")
				.every((box) => box.scrollWidth <= box.clientWidth + 1),
			"radio labels/counts clipped",
		);
		receipt.matrix.push({
			surface: "narrow 200% RTL",
			result: "PASS",
			geometry: narrow.bounds,
		});
		await cdp.evaluate(
			`(()=>{const key='ui-preferences-storage';const prefs=JSON.parse(localStorage.getItem(key));prefs.state.themeName='localOperatorLight';localStorage.setItem(key,JSON.stringify(prefs));location.reload();return true})()`,
		);
		await pause(1500);
		await open();
		await ready();
		await click(cdp, '[data-drawer-read-view="read"]');
		await capture("light-narrow-200-rtl-history");
		receipt.result = "PASS";
	} catch (error) {
		receipt.result = "FAIL";
		receipt.error = String(error.stack ?? error);
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

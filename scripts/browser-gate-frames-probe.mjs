import { createServer } from "node:http";
/**
 * How does a paused Document request identify its frame, and does the MAIN
 * frame's id survive a cross-origin navigation of that frame?
 *
 * This is the measurement the gate fix stands on: `Fetch.enable` with
 * `patterns: [{ resourceType: "Document" }]` pauses subframe documents too, so
 * the fix has to tell the main frame's document apart from everything else —
 * and the only attribution CDP offers on `Fetch.requestPaused` is `frameId`.
 *
 * Shape, all on loopback, window NEVER shown (`show: false`, no showInactive):
 *   origin A: /top.html      top-level document, embeds an iframe of origin B
 *             /again.html    a SECOND top-level document on A (in-page nav)
 *   origin B: /frame.html    the subframe document
 *             /landed.html   a cross-origin MAIN-frame navigation target
 *
 * Sequence: arm the app's gate shape -> load A/top.html (record frameIds) ->
 * navigate the MAIN frame to B/landed.html (cross-origin) -> record the frameId
 * of that navigation -> compare with Page.getFrameTree's main frame id before
 * and after.
 */
import { BrowserWindow, WebContentsView, app } from "electron";

const TAG = process.env.TAG || "gate-frames";
const t0 = Date.now();
const t = (m) =>
	process.stderr.write(
		`[${TAG}] +${((Date.now() - t0) / 1000).toFixed(1)}s ${m}\n`,
	);

app.commandLine.appendSwitch("use-mock-keychain");
app.setPath("userData", process.env.UD || `/tmp/${TAG}`);

function page(body) {
	return `<!doctype html><meta charset="utf-8">${body}`;
}

function startServer(name, routes) {
	return new Promise((resolve) => {
		const server = createServer((req, res) => {
			const route = routes[req.url] ?? null;
			if (route?.redirect) {
				res.writeHead(302, { Location: route.redirect });
				res.end();
				return;
			}
			res.writeHead(200, { "Content-Type": "text/html" });
			res.end(route ?? page("no route"));
		});
		server.listen(0, "127.0.0.1", () => {
			t(`${name} on ${server.address().port}`);
			resolve(server);
		});
	});
}

app
	.whenReady()
	.then(async () => {
		// B FIRST, because A's top-level page embeds an iframe whose src needs B's port.
		const b = await startServer("B", {
			"/frame.html": page("<h1>subframe (origin B)</h1>"),
			"/landed.html": page("<h1>landed (cross-origin main frame)</h1>"),
		});
		const bPort = b.address().port;
		const a = await startServer("A", {
			"/top.html": page(
				`<h1>top (origin A)</h1><iframe src="http://127.0.0.1:${bPort}/frame.html" width="300" height="200"></iframe>`,
			),
			"/again.html": page("<h1>again (top level, origin A)</h1>"),
		});
		const aPort = a.address().port;

		const win = new BrowserWindow({
			width: 900,
			height: 700,
			show: false,
			webPreferences: { backgroundThrottling: false },
		});
		const view = new WebContentsView({
			webPreferences: { contextIsolation: true, sandbox: true },
		});
		win.contentView.addChildView(view);
		view.setBounds({ x: 0, y: 0, width: 900, height: 700 });
		view.setVisible(true);
		const contents = view.webContents;

		// A view that has never loaded anything has no frame tree to read: `Page.enable`
		// on such a target HANGS (measured here: 90 s, no answer). The app's views always
		// have a document by the time the gate runs, and the cookie jar's hidden view
		// loads about:blank for the same reason, so this is the probe catching up to the
		// real sequence rather than a workaround.
		await contents.loadURL("about:blank");
		const bounded = (work, ms = 5000) =>
			Promise.race([
				work,
				new Promise((resolve) => setTimeout(() => resolve("TIMEOUT"), ms)),
			]);

		const APPROVED = `http://127.0.0.1:${aPort}`;
		const paused = [];
		contents.debugger.attach("1.3");
		contents.debugger.on("message", (_event, method, params) => {
			if (method !== "Fetch.requestPaused") return;
			const url = params?.request?.url ?? "";
			const approved = url.startsWith(APPROVED);
			paused.push({
				type: params.resourceType,
				frameId: params.frameId,
				url,
			});
			t(
				`PAUSED type=${params.resourceType} frameId=${params.frameId} ${approved ? "CONTINUE" : "REFUSE"} ${url}`,
			);
			contents.debugger
				.sendCommand(
					approved ? "Fetch.continueRequest" : "Fetch.failRequest",
					approved
						? { requestId: params.requestId }
						: { requestId: params.requestId, errorReason: "BlockedByClient" },
				)
				.catch(() => {});
		});

		t(
			`Page.enable -> ${await bounded(contents.debugger.sendCommand("Page.enable"))}`,
		);
		const treeBefore = await bounded(
			contents.debugger.sendCommand("Page.getFrameTree"),
		);
		const mainBefore = treeBefore?.frameTree?.frame?.id ?? null;
		t(`main frame id before: ${mainBefore}`);

		await contents.debugger.sendCommand("Fetch.enable", {
			patterns: [{ resourceType: "Document", requestStage: "Request" }],
		});
		try {
			await contents.loadURL(`http://127.0.0.1:${aPort}/top.html`);
			t("load settled (A/top.html)");
		} catch (error) {
			t(`loadURL threw ${error.message}`);
		}
		await new Promise((r) => setTimeout(r, 2000));

		const treeMid = await bounded(
			contents.debugger.sendCommand("Page.getFrameTree"),
		);
		t(
			`frames after top: main=${treeMid?.frameTree?.frame?.id} children=${JSON.stringify(
				(treeMid?.frameTree?.childFrames ?? []).map((c) => ({
					id: c.frame.id,
					url: c.frame.url,
				})),
			)}`,
		);

		// A cross-origin navigation of the MAIN frame: does its id survive?
		try {
			await contents.loadURL(`http://127.0.0.1:${bPort}/landed.html`);
			t("load settled (B/landed.html, cross-origin main frame)");
		} catch (error) {
			t(`cross-origin load threw ${error.message}`);
		}
		await new Promise((r) => setTimeout(r, 1500));
		const treeAfter = await bounded(
			contents.debugger.sendCommand("Page.getFrameTree"),
		);
		const mainAfter = treeAfter?.frameTree?.frame?.id ?? null;
		t(`main frame id after cross-origin nav: ${mainAfter}`);
		t(
			`MAIN-FRAME-ID-STABLE ${String(mainBefore !== null && mainBefore === mainAfter)}`,
		);

		// And back to an approved origin, to see the hop decide again.
		await contents.debugger.sendCommand("Fetch.disable");
		t(`PAUSES ${JSON.stringify(paused, null, 0)}`);
		a.close();
		b.close();
		app.quit();
	})
	.catch((error) => {
		t(`chain error ${error.stack}`);
		process.exit(4);
	});

setTimeout(() => {
	t("hard timeout");
	process.exit(0);
}, 90000);

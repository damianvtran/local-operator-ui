/**
 * The Electron entry that `session-cookie-electron.test.mjs` drives.
 *
 * It exists as its own file rather than as a string inside the test so a
 * reviewer can read the flow: each mode is one process against one isolated
 * user-data-dir, which is exactly what an app restart is. Modes (SC_MODE):
 *
 *   snapshot        set a battery of cookies through a real page, then store the
 *                   session-only ones with the shipped vault, and record the jar
 *                   before and after; also records what the ELECTRON cookie API
 *                   reports, which is the input a naive design would persist
 *   restore         a fresh profile: run the vault's restore, then record the jar
 *   naive-restore   a fresh profile: replay that API-shaped dump with
 *                   `session.cookies.set`, i.e. the design this feature rejects
 *   failclosed      a fresh profile with a cipher that refuses, against a real
 *                   snapshot: prove nothing is restored when encryption is gone
 *
 * No window is ever created: the only surface is an unattached WebContentsView,
 * which is never laid out, shown or focused. Every path is taken from the
 * environment, and nothing here touches the operator's own profile.
 *
 * The top-level page embeds a genuine third-party FRAME from a different site
 * (`127.0.0.1` inside a page on `localhost`): a `Partitioned` cookie set there is
 * the only way this runtime produces a key with `hasCrossSiteAncestor: true`, and
 * the frame reports what it itself could see. See `FRAME` below.
 */
const { app, session, webContents, WebContentsView } = require("electron");
const fs = require("node:fs");
const http = require("node:http");
const { pathToFileURL } = require("node:url");

const PARTITION = "persist:local-operator-browser";
const mode = process.env.SC_MODE;
const outFile = process.env.SC_OUT;
app.setPath("userData", process.env.SC_USER_DATA);

/** The battery, chosen so each hard case is present: a session cookie with
 * unspecified SameSite, one set over http with Secure, an HttpOnly one the page
 * cannot see, a path-scoped one, a partitioned (CHIPS) one, a non-default source
 * port, and a persistent cookie that must NOT be the vault's business.
 *
 * THE VALUES ARE LONG AND HYPHENATED ON PURPOSE — every value this file puts in
 * the jar, not only the pages below: the frame's two, the two the top-level
 * response sets, and `prio_high`, which is written through the jar API further
 * down. The assertion is a substring scan for each session cookie's value over
 * the stored snapshot, and a two-character value is evidence of nothing either
 * way, because the file is raw ciphertext: MEASURED, this scenario's own
 * snapshot is 2523 bytes — 2451 of ciphertext plus the 72-byte `\nsha256=` hex
 * suffix — so a two-byte ASCII value lands inside those bytes in about
 * 2522/65536 = 3.8% of runs, per run, not per machine. Measured,
 * historically: the original `srv_http=sh` collided with the literal `sha256=` in
 * the snapshot's own integrity digest, and `srv_chips=sc` collided with
 * ciphertext bytes on a later run, so that assertion was failing on material
 * carrying no cookie material at all. That rewrite missed `prio_high=ph` here,
 * which kept the same ~3.8% chance and took it — one false failure in seven
 * observed runs, on a security property, which is exactly the kind of green run
 * nobody can trust. Every value is now long enough, and hyphenated, for a hit to
 * mean a real leak: the only textual framing in the file is the digest's
 * lowercase hex, which cannot spell a hyphen, and a fifteen-byte value inside raw
 * ciphertext collides with probability about 2437/2^120 rather than with the few
 * percent a two-byte one has. */
const PAGE = `<!doctype html><html><body><script>
document.cookie = "plain_session=plain-session-value; Path=/";
document.cookie = "strict_path=strict-path-value; Path=/deep; SameSite=Strict";
document.cookie = "secure_over_http=secure-http-value; Path=/; Secure";
document.cookie = "chips_part=chips-part-value; Path=/; SameSite=None; Secure; Partitioned";
document.cookie = "persistent_a=persistent-value; Path=/; Max-Age=3600";
document.cookie = "high_priority=high-priority-value; Path=/";
</script></body></html>`;

/**
 * The third-party frame's page, served from a DIFFERENT site than the top-level
 * page (`127.0.0.1` inside `localhost`).
 *
 * WHY IT IS HERE: a `Partitioned` cookie is only given
 * `hasCrossSiteAncestor: true` when it is set from a frame whose site differs from
 * the top-level site, and that is the one shape CHIPS exists for. With a top-level
 * page setting every cookie itself, every partition key in the battery comes out
 * `false` — which is exactly the gap this frame closes, because the guarantee for
 * `true` must rest on the committed battery rather than on one reviewer's probe.
 *
 * It also reports what IT can see, because the isolation argument rests on what a
 * third-party frame does and does not receive. The frame fetches its own
 * `/frame-view?seen=...` with credentials, so the scenario records both the
 * frame's own `document.cookie` and the `Cookie:` header the browser actually
 * sent on that request — the difference between "the frame saw none of the
 * top-level page's cookies" and "the frame sees no cookies at all", which are not
 * the same statement and were once written as if they were.
 */
const FRAME = `<!doctype html><html><body><script>
document.cookie = "chips_3p=chips-third-party-value; Path=/; SameSite=None; Secure; Partitioned";
document.cookie = "plain_3p=plain-third-party-value; Path=/; SameSite=None; Secure";
fetch("/frame-view?seen=" + encodeURIComponent(document.cookie), { credentials: "include" });
</script></body></html>`;

/** The frame's own origin, recording its report for the scenario to read. */
function frameServer() {
	let seen = null;
	const server = http.createServer((req, res) => {
		if ((req.url ?? "").startsWith("/frame-view")) {
			seen = {
				cookieHeader: req.headers.cookie ?? "",
				frameView:
					new URL(req.url, "http://127.0.0.1").searchParams.get("seen") ??
					"",
			};
			res.writeHead(204);
			res.end();
			return;
		}
		res.writeHead(200, { "content-type": "text/html" });
		res.end(FRAME);
	});
	return { server, seen: () => seen };
}

function batteryServer(frameUrl) {
	const page = PAGE.replace(
		"</body>",
		`<iframe src="${frameUrl}"></iframe></body>`,
	);
	return http.createServer((_req, res) => {
		res.writeHead(200, {
			"content-type": "text/html",
			"set-cookie": [
				"srv_http=srv-http-value; Path=/; HttpOnly; SameSite=Strict",
				"srv_chips=srv-chips-value; Path=/; Secure; SameSite=None; Partitioned; HttpOnly",
			],
		});
		res.end(page);
	});
}

async function main() {
	const mod = await import(pathToFileURL(process.env.SC_BUNDLE).href);
	const s = session.fromPartition(PARTITION);
	// The frame's origin first: its URL has to be in the top-level page's markup.
	const frame = frameServer();
	const framePort = await new Promise((resolve) =>
		frame.server.listen(0, "127.0.0.1", () =>
			resolve(frame.server.address().port),
		),
	);
	const frameOrigin = `http://127.0.0.1:${framePort}`;
	const server = batteryServer(`${frameOrigin}/`);
	const port = await new Promise((resolve) =>
		server.listen(0, "127.0.0.1", () => resolve(server.address().port)),
	);
	const origin = `http://localhost:${port}`;

	/** Wait for the frame's own report: its cookie is a subresource's, so it lands
	 * after the top-level load the scenario awaits. */
	const frameReportWithin = async (ms) => {
		const deadline = Date.now() + ms;
		while (Date.now() < deadline) {
			if (frame.seen()) return frame.seen();
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
		return null;
	};

	const view = new WebContentsView({
		webPreferences: {
			partition: PARTITION,
			sandbox: true,
			contextIsolation: true,
			nodeIntegration: false,
		},
	});
	// The shipped transport, so the test drives the same code the app runs rather
	// than a parallel CDP path of its own.
	const jar = mod.createDebuggerCookieJar({
		debugger: view.webContents.debugger,
		loadAboutBlank: () =>
			view.webContents.loadURL("about:blank").then(() => undefined),
	});
	const readJar = () => jar.readAllCookies();

	const log = [];
	const sessionCookies = new mod.SessionCookieVault({
		jar,
		cipher: mod.createSafeStorageCipher(require("electron").safeStorage),
		...mod.sessionCookiePaths(process.env.SC_USER_DATA),
		clearSessionData: async () => {},
		log: (line) => log.push(line),
	});
	const result = { mode, origin, logs: log };

	if (mode === "snapshot") {
		await view.webContents.loadURL(origin);
		// The third-party frame's cookie is a subresource's, so wait for its own
		// report rather than reading the jar the moment the top-level page settles.
		result.thirdPartyFrame = await frameReportWithin(5000);
		// One cookie the page cannot set: a non-default eviction priority. It also
		// covers a jar entry written through the same channel the restore uses.
		// Its value is long for the same reason the pages' are (see the battery
		// comment above): the plaintext scan reads EVERY session cookie's value out
		// of this jar, this entry included, so a short one here can fail the scan on
		// chance alone. It was `ph` — two bytes, ~3.8% per run, one false failure
		// observed in seven runs.
		await jar.writeCookie({
			name: "prio_high",
			value: "prio-high-value",
			url: `${origin}/`,
			path: "/",
			priority: "High",
		});
		result.before = await readJar();
		// What the Electron cookie API reports — the naive design's whole input.
		result.apiView = await s.cookies.get({});
		result.restoreOnFirstRun = await sessionCookies.restore();
		result.snapshot = await sessionCookies.snapshot();
		result.afterSnapshot = await readJar();
	} else if (mode === "restore") {
		result.restore = await sessionCookies.restore();
		result.jar = await readJar();
	} else if (mode === "naive-restore") {
		const apiView = JSON.parse(fs.readFileSync(process.env.SC_IN, "utf8"));
		for (const cookie of apiView) {
			const scheme = cookie.secure ? "https" : "http";
			try {
				await s.cookies.set({
					url: `${scheme}://${cookie.domain}${cookie.path}`,
					name: cookie.name,
					value: cookie.value,
					secure: cookie.secure,
					httpOnly: cookie.httpOnly,
					sameSite: cookie.sameSite,
					...(cookie.hostOnly ? {} : { domain: cookie.domain }),
					...(cookie.session ? {} : { expirationDate: cookie.expirationDate }),
				});
			} catch (error) {
				result.setError = (result.setError ?? []).concat([
					`${cookie.name}: ${String(error)}`,
				]);
			}
		}
		result.jar = await readJar();
		result.apiView = await s.cookies.get({});
	} else if (mode === "failclosed") {
		const refusing = {
			availability: () => ({ ok: false, reason: "no keychain in this run" }),
			encrypt: () => {
				throw new Error("must not encrypt without a keychain");
			},
			decrypt: () => {
				throw new Error("must not decrypt without a keychain");
			},
		};
		const withRefusingCipher = new mod.SessionCookieVault({
			jar,
			cipher: refusing,
			...mod.sessionCookiePaths(process.env.SC_USER_DATA),
			clearSessionData: async () => {},
			log: (line) => log.push(line),
		});
		result.restore = await withRefusingCipher.restore();
		result.jar = await readJar();
	} else {
		throw new Error(`unknown SC_MODE ${String(mode)}`);
	}

	// `webContents` is referenced so the import list documents that this entry
	// touches no window surface; a session's own webContents count is recorded so
	// a reader can see nothing extra was created.
	result.webContentsCount = webContents.getAllWebContents().length;
	fs.writeFileSync(outFile, `${JSON.stringify(result, null, 1)}\n`);
	console.log(`scenario ${mode}: wrote ${outFile}`);
	server.close();
	frame.server.close();
	if (view.webContents.debugger.isAttached())
		view.webContents.debugger.detach();
	if (!view.webContents.isDestroyed()) view.webContents.close();
}

app
	.whenReady()
	.then(main)
	.then(
		() => app.exit(0),
		(error) => {
			console.error("SCENARIO FAILED", error);
			app.exit(1);
		},
	);

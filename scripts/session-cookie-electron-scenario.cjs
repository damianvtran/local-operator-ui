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
 * port, and a persistent cookie that must NOT be the vault's business. */
const PAGE = `<!doctype html><html><body><script>
document.cookie = "plain_session=ps; Path=/";
document.cookie = "strict_path=sp; Path=/deep; SameSite=Strict";
document.cookie = "secure_over_http=soh; Path=/; Secure";
document.cookie = "chips_part=cp; Path=/; SameSite=None; Secure; Partitioned";
document.cookie = "persistent_a=pa; Path=/; Max-Age=3600";
document.cookie = "high_priority=hp; Path=/";
</script></body></html>`;

function batteryServer() {
	return http.createServer((_req, res) => {
		res.writeHead(200, {
			"content-type": "text/html",
			"set-cookie": [
				"srv_http=sh; Path=/; HttpOnly; SameSite=Strict",
				"srv_chips=sc; Path=/; Secure; SameSite=None; Partitioned; HttpOnly",
			],
		});
		res.end(PAGE);
	});
}

async function main() {
	const mod = await import(pathToFileURL(process.env.SC_BUNDLE).href);
	const s = session.fromPartition(PARTITION);
	const server = batteryServer();
	const port = await new Promise((resolve) =>
		server.listen(0, "127.0.0.1", () => resolve(server.address().port)),
	);
	const origin = `http://localhost:${port}`;

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
		// One cookie the page cannot set: a non-default eviction priority. It also
		// covers a jar entry written through the same channel the restore uses.
		await jar.writeCookie({
			name: "prio_high",
			value: "ph",
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

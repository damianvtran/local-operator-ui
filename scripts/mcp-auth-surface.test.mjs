import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The seams round 3 broke, pinned where each defect lived.
 *
 *   - B1 (BLOCKER): the shared dialog and the refusal memo read the `probe`
 *     answer one envelope level too shallow, so every entry point opened a dialog
 *     that could only say it could not determine the sign-in method.
 *   - M1 (MAJOR): Settings dropped the only `Copy setup prompt` control while its
 *     own sentence still told the user to copy it.
 *   - m1 (MINOR): `parseMcpIntent` tested the reserved word `list` before the
 *     configured names, so a server named `list` was unreachable by its bare name.
 *
 * Each has an EXECUTION half where the defect is executable, and a SOURCE half
 * where it is a fact about how the renderer is wired: the envelope read is ONE
 * read, and a new caller that spells the probe itself is where B1 comes back —
 * which no execution test of the two files I happen to name can see.
 */

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/shared/api/local-operator/mcp-list";' +
			'export { parseMcpIntent } from "./src/renderer/src/features/chat/pickers/mcp-command";' +
			'export { resolveMcpServerTarget } from "./src/renderer/src/features/settings/components/mcp-management-section";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	tsconfig: "tsconfig.web.json",
	// The component tree imports styles from its story, not from itself; this
	// keeps a CSS import from failing the bundle if one is added beside it.
	loader: { ".css": "empty" },
});
const { fetchMcpProbe, parseMcpIntent, resolveMcpServerTarget } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/**
 * A real `mcp.control {action:"probe"}` answer, in the route's own wrapping.
 *
 * `desktop_lifecycle.py` replies `reply({"data": result["data"]})`, and `reply` is
 * `CRUDResponse(…, result=result)`, so the HTTP body is `{"result": {"data": …}}`
 * and `desktopResult` returns `envelope.result` — the payload is one level DOWN
 * from what the shipped dialog read.
 */
const PROBE_OAUTH = {
	name: "hubspot",
	transport_oauth_supported: true,
	secret_refs: [{ id: "HUBSPOT_TOKEN", bindings: [{ field: "headers", key: "Authorization" }] }],
	key_submission_supported: true,
};
const PROBE_KEY = {
	name: "google-workspace",
	transport_oauth_supported: false,
	secret_refs: [{ id: "GOOGLE_CLIENT_SECRET", bindings: [{ field: "env", key: "API_KEY" }] }],
	key_submission_supported: true,
};

const installBridge = (payload, sent) => {
	const page = globalThis;
	page.window = page.window ?? {};
	page.window.api = {
		desktop: {
			// The preload bridge seam, i.e. the path the product itself uses.
			request: async (request) => {
				sent.push(request);
				return { status: 200, body: { result: { data: payload } } };
			},
		},
	};
};

test("fetchMcpProbe returns the probe, not the envelope around it", async () => {
	const sent = [];
	installBridge(PROBE_OAUTH, sent);

	const probe = await fetchMcpProbe("session-1", "hubspot");

	assert.deepEqual(sent, [
		{
			op: "mcp.control",
			sessionId: "session-1",
			control: { action: "probe", name: "hubspot" },
		},
	]);
	// These three are what the dialog's cascade branches on: the grant arm, the
	// key arm's field list, and whether a key write is offered at all.
	assert.equal(probe.transport_oauth_supported, true);
	assert.deepEqual(
		(probe.secret_refs ?? []).map((ref) => ref.id),
		["HUBSPOT_TOKEN"],
	);
	assert.equal(probe.key_submission_supported, true);
});

test("the shallow read the dialog used answers neither true nor false", () => {
	/*
	 * The exact value B1 compared. `desktopResult` was typed at the payload's own
	 * level, so `probe.transport_oauth_supported` was `undefined` at runtime — not
	 * `true`, so the grant arm was dead, and not `false`, so the key arm's
	 * "does not use OAuth" arm was dead too and EVERY server took the third
	 * sentence, "Could not determine this server's sign-in method."
	 *
	 * This assertion is what breaks if `fetchMcpProbe` ever returns the envelope:
	 * the fields move back under `.data` and both comparisons go undefined again.
	 */
	const envelope = { data: PROBE_OAUTH, replayed: false };
	assert.equal(envelope.transport_oauth_supported === true, false);
	assert.equal(envelope.transport_oauth_supported === false, false);
	// And the payload itself is what the two arms need.
	assert.equal(PROBE_OAUTH.transport_oauth_supported === true, true);
});

test("the key arm's own probe reads the same level", async () => {
	const sent = [];
	installBridge(PROBE_KEY, sent);

	const probe = await fetchMcpProbe("session-1", "google-workspace");

	// `refusalFor`'s read, which decides between "not-oauth" and "refused".
	assert.equal(probe.transport_oauth_supported === false, true);
	assert.deepEqual(
		(probe.secret_refs ?? []).map((ref) => ref.id),
		["GOOGLE_CLIENT_SECRET"],
	);
});

test("only the shared module spells the probe op", () => {
	/*
	 * The half that keeps B1 from returning through a NEW caller. The defect was
	 * two independent reads of one route, each typed at the wrong level, and a test
	 * over the two files it happened to touch cannot see a third arrive — this can,
	 * wherever it lands. A file that needs the probe takes `fetchMcpProbe`.
	 */
	const offenders = [];
	const walk = (dir) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) walk(path);
			else if (
				/\.(ts|tsx)$/.test(entry.name) &&
				!/mcp-list\.ts$/.test(path) &&
				/action:\s*["']probe["']/.test(readFileSync(path, "utf8"))
			)
				offenders.push(path);
		}
	};
	walk("src/renderer/src");
	assert.deepEqual(
		offenders,
		[],
		"only mcp-list.ts may read the mcp.control probe: a caller that spells it itself reads the route's envelope one level too shallow",
	);

	for (const file of [
		"src/renderer/src/features/chat/components/run-details/mcp-auth-dialog.tsx",
		"src/renderer/src/features/chat/components/run-details/use-mcp-remedy.ts",
	]) {
		assert.match(
			readFileSync(file, "utf8"),
			/fetchMcpProbe/,
			`${file} must take the probe from the shared read`,
		);
	}
});

test("the settings row still offers the setup action its own sentence names", () => {
	/*
	 * M1: the paragraph tells the user to copy the setup prompt, so a control that
	 * copies `setup.text` has to be on that row. Asserted as a PAIRING rather than
	 * as two separate greps — the defect was exactly the sentence surviving the
	 * control, which either half alone passes.
	 */
	const section = readFileSync(
		"src/renderer/src/features/settings/components/mcp-management-section.tsx",
		"utf8",
	);
	const namesTheAction = /Copy the setup prompt/.test(section);
	const offersTheAction =
		/Copy setup prompt/.test(section) &&
		/navigator\.clipboard\s*\.?\s*\n?\s*\.writeText\(server\.setup\?\.text/.test(
			section,
		);
	assert.equal(
		namesTheAction && !offersTheAction,
		false,
		"the row cannot tell the user to copy a setup prompt it does not offer",
	);
});

test("a server named `list` is reachable by its bare name", () => {
	// m1: the reserved word was tested first, so `list` was the one configured name
	// the bare form could not reach — the opposite of the module's own comment.
	assert.deepEqual(parseMcpIntent("list", ["list", "hubspot"]), {
		kind: "auth",
		name: "list",
		action: "login",
	});
	// Without a server by that name the bare form is still the list.
	assert.deepEqual(parseMcpIntent("list", ["hubspot"]), {
		kind: "list",
		action: "login",
	});
	// And the section's resolver follows it, which is the user-visible half.
	assert.deepEqual(resolveMcpServerTarget("list", ["list", "hubspot"]), {
		kind: "matched",
		name: "list",
		unresolved: null,
	});
	// `login`/`reauth` keep resolving as exact names, as they did before.
	assert.deepEqual(parseMcpIntent("login", ["login"]), {
		kind: "auth",
		name: "login",
		action: "login",
	});
});

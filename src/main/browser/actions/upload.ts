import { statSync } from "node:fs";
import { basename, isAbsolute } from "node:path";
import { BrowserHostError } from "../errors";
import type { FileFact } from "../protocol";
import type { TabRecord } from "../registry";
import { safeName } from "../vendor/driver/file-transfer-policy";
import { CAPS } from "../vendor/driver/file-transfer.tables.gen";
import type { BrowserActionContext } from "./context";
import { stringParam } from "./context";
import { pageOf } from "./gate";
import { resolveNode } from "./input";

/**
 * `upload`: attach real local files to a page's file input.
 * Design: docs/design/browser-file-transfer.md §6.1, §9.2, §9.3, §9.4.
 *
 * WHY `DOM.setFileInputFiles` AND NOTHING ELSE. It is the CDP primitive Puppeteer
 * and Playwright use, it is available over the tab-scoped session the browser
 * driver already holds, and it makes the BROWSER PROCESS read the bytes off disk —
 * so nothing here base64-inflates a 40 MB PDF through the wire, and the file the
 * page receives is the file the user has. The extension host uses the same
 * command for the same reason (measured working on a `<input multiple>`,
 * 2026-09-18: read-back `{"count":2,"names":["deck.pptx","notes file with
 * spaces.pdf"],"sizes":[13,69]}`).
 *
 * WHAT THIS MODULE DOES NOT DECIDE. Whether a local file MAY leave is Python's
 * (`browser_files.check_upload`): the workspace rule, the credential deny-list,
 * the config-root refusal and the caps are all judged there, on the RESOLVED path,
 * before the call is dispatched. This host attaches the paths it is given and
 * reports what the DOM actually holds. The one thing it must NOT do is second-
 * guess a file from its name — a host-side copy of the deny-list would be a second
 * policy that can disagree with the authoritative one, and §9.2's rules need the
 * resolved path, which is the harness's fact, not this host's.
 *
 * THE READ-BACK IS THE POINT (§9.3). A file input that silently ignored the call
 * must not be reported as filled: `type`'s rule — compare the read-back, never
 * interpolate what was sent — is applied to attachments. The comparison is
 * name-and-size against the files on disk, and a mismatch fails the call naming
 * BOTH sides, because "the input holds nothing" and "the input holds something
 * else" have different remedies.
 */

/** What the DOM holds after the attach, read back over the same session. */
interface InputReadBack {
	count: number;
	names: string[];
	sizes: number[];
}

/** Read `input.files` from the resolved node.
 *
 * A function on the NODE rather than a `document.querySelector` in the page: the
 * target may be a snapshot ref (`e5`), which no CSS selector can address, and
 * `DOM.resolveNode` already gave us the object. `returnByValue` keeps the answer
 * to names and sizes — never the file's contents, which this host has no business
 * reading through the page. */
const READ_FILES_FUNCTION = `function () {
  if (!("files" in this) || this.files === null) return null;
  const files = Array.from(this.files);
  return { count: files.length, names: files.map((f) => f.name), sizes: files.map((f) => f.size) };
}`;

/** What a selector names, when it names something that is not a file input. */
const NOT_A_FILE_INPUT =
	'that selector is not a file input; snapshot the page and use the element that <input type="file"> names';

export async function upload(
	ctx: BrowserActionContext,
	params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const record = ctx.registry.requireSurface(params.tab);
	const selector = stringParam(params, "selector");
	if (!selector) {
		throw new BrowserHostError(
			"element_not_found",
			"upload needs a selector naming the file input",
		);
	}
	const paths = uploadPaths(params);
	const contents = record.view.webContents;
	const node = await resolveNode(ctx, record, selector);

	// Reported, never obeyed (§9.3): a site's `accept` does not protect the user's
	// files, and honouring it would let a PAGE steer which files the agent tries to
	// attach. It is read here so the number that appears in the log and in a
	// mismatch's data is the input's own, which is what makes a failure
	// explainable.
	const accept = await acceptsOf(ctx, record, node.nodeId);

	await ctx.cdp.send(contents, "DOM.setFileInputFiles", {
		files: paths,
		nodeId: node.nodeId,
	});

	const held = await readBack(ctx, record, node.objectId);
	if (!held) {
		throw new BrowserHostError("element_not_found", NOT_A_FILE_INPUT, {
			selector,
			accept,
		});
	}
	assertHolds(paths, held, selector, accept);

	ctx.registry.touch(record);
	return {
		// The selectors that accepted files. One entry today, because the wire takes
		// one `selector`; the field is a list because the result vocabulary is shared
		// with the extension host, whose `DOM.setFileInputFiles` call can address the
		// same shape.
		inputs: [selector],
		accepted: paths.map(factOf),
		// The page's own identity, as every other action reports it: the harness's audit
		// row for this call records the origin the files went TO, and a host that answered
		// without it would leave that row naming nowhere.
		...pageOf(record.view),
	};
}

/** The `paths` parameter: a non-empty list of absolute paths.
 *
 * ABSOLUTE is enforced here because the host's job is to hand the browser process
 * paths it can open, and a relative one would resolve against the APP's working
 * directory rather than the session's — a file the user never named. The harness
 * resolves and checks the paths before dispatching; this is the boundary that says
 * so rather than silently attaching something else. */
function uploadPaths(params: Record<string, unknown>): string[] {
	const raw = params.paths;
	if (!Array.isArray(raw) || raw.length === 0) {
		throw new BrowserHostError(
			"internal",
			"upload needs a non-empty list of paths",
			{ param: "paths" },
		);
	}
	const paths: string[] = [];
	for (const entry of raw) {
		if (typeof entry !== "string" || !entry.trim()) {
			throw new BrowserHostError(
				"internal",
				"every upload path must be a non-empty string",
				{ param: "paths" },
			);
		}
		const path = entry.trim();
		if (!isAbsolute(path)) {
			throw new BrowserHostError(
				"internal",
				`upload needs absolute paths; ${safeName(path)} is not one`,
				{ param: "paths" },
			);
		}
		paths.push(path);
	}
	if (paths.length > CAPS.uploadMaxFiles) {
		throw new BrowserHostError(
			"internal",
			`upload takes at most ${CAPS.uploadMaxFiles} files per call`,
			{ param: "paths", limit: CAPS.uploadMaxFiles },
		);
	}
	return paths;
}

/** The input's own `accept` attribute, or "" when it has none. */
async function acceptsOf(
	ctx: BrowserActionContext,
	record: TabRecord,
	nodeId: number,
): Promise<string> {
	const attributes = await ctx.cdp.send<{ attributes?: string[] }>(
		record.view.webContents,
		"DOM.getAttributes",
		{ nodeId },
	);
	const list = attributes?.attributes ?? [];
	for (let index = 0; index + 1 < list.length; index += 2) {
		if (list[index] === "accept") return list[index + 1] ?? "";
	}
	return "";
}

async function readBack(
	ctx: BrowserActionContext,
	record: TabRecord,
	objectId: string,
): Promise<InputReadBack | null> {
	const answer = await ctx.cdp.send<{
		result?: { value?: InputReadBack | null };
	}>(record.view.webContents, "Runtime.callFunctionOn", {
		objectId,
		functionDeclaration: READ_FILES_FUNCTION,
		returnByValue: true,
	});
	return answer?.result?.value ?? null;
}

/** Compare what the DOM holds to the files that were handed to it.
 *
 * Both sides are named on a mismatch. Size is compared as well as the name
 * because a page that re-created the File objects from something else (a canvas,
 * a fetch) would match on the name and differ on the bytes; the size is the
 * cheapest fact that catches it without reading contents. */
function assertHolds(
	paths: string[],
	held: InputReadBack,
	selector: string,
	accept: string,
): void {
	const expected = paths.map((path) => basename(path));
	const mismatch =
		held.count !== expected.length ||
		expected.some((name, index) => held.names[index] !== name) ||
		paths.some((path, index) => sizeOf(path) !== held.sizes[index]);
	if (!mismatch) return;
	throw new BrowserHostError(
		"internal",
		`the file input did not take the files: it holds ${summarise(held)}, and ${expected.length} were attached (${expected.join(", ")})`,
		{
			selector,
			attached: expected,
			held: held.names,
			accept,
			reason: "read_back_mismatch",
		},
	);
}

function summarise(held: InputReadBack): string {
	if (held.count === 0) return "nothing";
	return `${held.count} file(s) [${held.names.join(", ")}]`;
}

function sizeOf(path: string): number {
	try {
		return statSync(path).size;
	} catch {
		return -1;
	}
}

/** The fact Python is told about one attached file. `sha256` is empty for the
 * same reason it is on the download path (§6.1): Python hashes the file it reads,
 * and a host-reported digest would be a host's word taken on trust. */
function factOf(path: string): FileFact {
	return {
		name: basename(path),
		path,
		bytes: sizeOf(path),
		mime: "",
		sniffed: "",
		sha256: "",
	};
}

/** Exported (with its types) so the desktop suite can drive the read-back
 * comparison without a browser, which is the check that decides whether an attach
 * is believed. */
export { assertHolds as assertInputHolds };
export type { InputReadBack };

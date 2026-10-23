#!/usr/bin/env node
/**
 * The `afterPack` hook: keep only the runtime resource trees this build can run
 * (the bundled `uv`, on every platform, and the interpreter seed on macOS,
 * where it ships), give every nested helper bundle the app's icon on macOS, and
 * - on macOS - refuse to ship a legacy resource alias beside the private seed.
 *
 * Why the alias refusal is a build failure rather than a nicety: the seed is
 * inert data that nothing executes from the `.app`, but an incumbent install's
 * venv still names `Contents/Resources/python[_aarch64]/bin` in its
 * `pyvenv.cfg`. A directory there - even a dangling symlink - would let that
 * venv reach the new bundle's tree during the window between ShipIt's swap and
 * the candidate's first instruction, which is the self-unsealing failure this
 * work exists to remove. Failing closed is the point, so this throws rather
 * than warns.
 *
 * No access-control sealing happens here any more. It could not be a
 * correctness mechanism (a ZIP drops the entries, so an in-app update stages
 * an unsealed bundle), and with no venv resolving its stdlib inside an `.app`
 * there is nothing left in a bundle to seal - see `managed-python.ts`.
 *
 * The context shape is resolved the same way the prune step resolves it: a
 * missing `packager.appInfo` is a programming error rather than a build
 * condition, and defaulting here would guess the bundle's name.
 */
import {
	copyFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { LEGACY_RESOURCE_NAMES } from "./bundled-runtime-layout.mjs";
import { prepareConsoleNative } from "./console-pack.mjs";
import pruneAfterPack from "./prune-bundled-resources.mjs";

/**
 * The legacy resource names a bundle must never carry again.
 *
 * Read from the app's own layout definition rather than written out again here.
 * They are the names shipped builds used - `python_aarch64` on arm64, `python` on
 * x64 - and the point of the check is that they stay gone; the set is defined by
 * the layout, not by this hook, so adding a name to the definition is what
 * changes both halves at once.
 */
const LEGACY_PYTHON_RESOURCE_NAMES = LEGACY_RESOURCE_NAMES;

/**
 * Give every nested helper bundle the app's own icon, on macOS.
 *
 * WHY THIS EXISTS. macOS resolves an app's icon from its bundle: the icon named
 * by `CFBundleIconFile` in `Contents/Info.plist`, under `Contents/Resources`.
 * Electron's helper bundles ship with neither key nor file - they are generic
 * helpers whose display name comes from the helper's own plist - so a dialog
 * that attributes a request to a helper has nothing to draw and falls back to a
 * generic mark. The 1Password CLI-access prompt is one such dialog: it reads
 * `CFBundleIconFile` from the bundle it resolved, then loads the named file.
 * The helper bundles are inside our app and are named after it, so they must
 * carry the same icon as the app rather than the generic placeholder.
 *
 * WHY `afterPack` AND NOT `extraResources`: electron-builder creates the
 * helpers itself, after the resource copy lists are applied, and it signs them
 * immediately after this hook. Writing the plist key and the icns here means
 * both are inside the code seal; writing them at install time would invalidate
 * the signature, and writing them after signing would be the same violation in
 * the opposite order.
 *
 * The source is the icon electron-builder just placed in the main bundle, so
 * every helper is stamped from the one artwork the build carries. `build.mac.icon`
 * is explicit in `package.json`; if that ever stops producing `icon.icns`, this
 * throws instead of shipping helpers with a stale or absent icon.
 *
 * WHY THE PLIST IS EDITED IN JAVASCRIPT RATHER THAN WITH `plutil`. `afterPack`
 * itself only ever runs on macOS, but `scripts/icon-identity.test.mjs` runs in
 * the ubuntu `Desktop Tests` job, where `/usr/bin/plutil` does not exist. A test
 * that cannot run on the runner is not coverage, and a bare `catch` around the
 * tool would turn "plutil is missing" into "this bundle has no icon" - a false
 * diagnosis of the exact class this change fixes. The plists electron-builder
 * writes are XML, so a small keyed read/write over the text is portable and
 * fails closed on a binary plist instead of guessing.
 */
const XML_ESCAPES = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&apos;",
};

function escapeXml(value) {
	return String(value).replace(
		/[&<>"']/g,
		(character) => XML_ESCAPES[character],
	);
}

function unescapeXml(value) {
	return value.replace(/&(amp|lt|gt|quot|apos);/g, (_, entity) => {
		return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[entity];
	});
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A macOS property list this hook can edit: XML, not the binary form.
 *
 * Electron-builder writes XML here, and every generated helper does too. A
 * binary plist would make the keyed read/write below silently see "no key" and
 * stamp nothing, so it is a named failure rather than a fall-through.
 */
export function assertXmlPlist(text, path) {
	if (text.startsWith("bplist")) {
		throw new Error(
			`${path} is a binary property list. This hook edits the XML plists electron-builder writes; teach it the binary form before shipping a bundle whose helper cannot be stamped.`,
		);
	}
	if (!text.includes("<plist")) {
		throw new Error(`${path} does not look like an XML property list.`);
	}
}

/** The string value for `key` in an XML plist, or null when the key is absent. */
export function readPlistString(text, key) {
	const pattern = new RegExp(
		`<key>${escapeRegExp(escapeXml(key))}</key>\\s*<string>([^<]*)</string>`,
	);
	const match = pattern.exec(text);
	return match ? unescapeXml(match[1]) : null;
}

/**
 * Return `text` with `key` set to `value`, replacing the existing entry or
 * inserting one before the plist's final `</dict>`.
 */
export function setPlistString(text, key, value) {
	const pattern = new RegExp(
		`(<key>${escapeRegExp(escapeXml(key))}</key>\\s*<string>)[^<]*(</string>)`,
	);
	if (pattern.test(text)) {
		// A function replacer, not a replacement string: a `$` in the value
		// would otherwise be read as a replacement token and corrupt the plist.
		return text.replace(
			pattern,
			(_match, open, close) => `${open}${escapeXml(value)}${close}`,
		);
	}
	const close = text.lastIndexOf("</dict>");
	if (close === -1) {
		throw new Error(`Cannot find the closing </dict> to insert ${key}.`);
	}
	return `${text.slice(0, close)}\t<key>${escapeXml(key)}</key>\n\t<string>${escapeXml(value)}</string>\n${text.slice(close)}`;
}

export function stampBundleIcons({ appOutDir, productFilename, platform }) {
	if (platform !== "darwin" && platform !== "mas") return { stamped: [] };

	const appDir = join(appOutDir, `${productFilename}.app`);
	const mainPlist = join(appDir, "Contents", "Info.plist");
	const source = join(appDir, "Contents", "Resources", "icon.icns");
	if (!existsSync(source)) {
		throw new Error(
			`The packed app has no ${source}. build.mac.icon in package.json must name an .icns that electron-builder copies into Contents/Resources; the helper bundles are stamped from it.`,
		);
	}

	const mainText = readFileSync(mainPlist, "utf8");
	assertXmlPlist(mainText, mainPlist);
	const mainIcon = readPlistString(mainText, "CFBundleIconFile");
	if (mainIcon === null) {
		throw new Error(
			`The packed app's Info.plist carries no CFBundleIconFile (${mainPlist}). build.mac.icon must be set explicitly so the bundle, and every helper stamped from it, has an icon.`,
		);
	}
	if (mainIcon !== "icon.icns") {
		throw new Error(
			`The packed app's CFBundleIconFile is ${JSON.stringify(mainIcon)}, not "icon.icns". The helper stamping below copies Contents/Resources/icon.icns and records that name; make the two agree rather than shipping helpers that point at a file the app does not carry.`,
		);
	}

	const frameworks = join(appDir, "Contents", "Frameworks");
	if (!existsSync(frameworks)) {
		throw new Error(
			`The packed app has no ${frameworks}. A macOS Electron app carries its helper bundles there; refusing to report success for a bundle that has none.`,
		);
	}

	const stamped = [];
	for (const entry of readdirSync(frameworks)) {
		if (!entry.endsWith(".app")) continue;
		const bundle = join(frameworks, entry);
		const plist = join(bundle, "Contents", "Info.plist");
		if (!existsSync(plist)) continue;

		const helperResources = join(bundle, "Contents", "Resources");
		mkdirSync(helperResources, { recursive: true });
		copyFileSync(source, join(helperResources, "icon.icns"));

		const plistText = readFileSync(plist, "utf8");
		assertXmlPlist(plistText, plist);
		writeFileSync(
			plist,
			setPlistString(plistText, "CFBundleIconFile", "icon.icns"),
		);
		stamped.push(entry);
	}
	if (stamped.length === 0) {
		throw new Error(
			`No nested helper .app bundles were found under ${frameworks}. A macOS Electron app carries at least one; refusing to report success for a bundle whose helpers were not stamped.`,
		);
	}
	return { stamped };
}

/**
 * See the hook's module comment for why this runs before signing.
 */
export default async function afterPack(context) {
	const productFilename = context.packager?.appInfo?.productFilename;
	if (productFilename == null) {
		throw new Error(
			"Cannot prepare the bundled runtime resources: afterPack context has no packager.appInfo.productFilename",
		);
	}
	/*
	 * The console's native dependency, first and unconditionally.
	 *
	 * BEFORE SIGNING, which is the whole reason it is here: `afterPack` runs while
	 * the bundle is still writable and unsigned, so a helper whose exec bit this
	 * restores is signed with the mode it will ship with. Doing it after signing
	 * would invalidate the seal, and doing it only at install time would miss
	 * exactly the update path that motivated it (a ZIP drops modes and `codesign`'s
	 * seal does not cover them).
	 *
	 * It does not depend on the bundled-resource prune below, and that prune returns
	 * early when the resources directory cannot be resolved — so the console step
	 * must run before that decision rather than inside it.
	 */
	prepareConsoleNative({
		appOutDir: context.appOutDir,
		productFilename,
		arch: context.arch,
		platform: context.electronPlatformName ?? process.platform,
		log: (line) => console.log(line),
	});

	const stamped = stampBundleIcons({
		appOutDir: context.appOutDir,
		productFilename,
		platform: context.electronPlatformName ?? process.platform,
	});
	if (stamped.stamped.length > 0) {
		console.log(
			`Stamped the app icon into helper bundle(s): ${stamped.stamped.join(", ")}`,
		);
	}

	const pruned = await pruneAfterPack(context);

	// The legacy-alias refusal is macOS's alone, and the scope matters. On macOS
	// the names below are the ones shipped builds used and the seed namespace
	// exists to keep them out; on Windows and Linux `python`/`python_aarch64` are
	// the LIVE names their copy lists write, so refusing them there would fail a
	// build over the very layout those platforms are supposed to have.
	const platform = context.electronPlatformName ?? process.platform;
	if (platform !== "darwin") return pruned;

	const surviving = [];
	for (const name of LEGACY_PYTHON_RESOURCE_NAMES) {
		// lstat, not exists: a dangling symlink is exactly the alias we must
		// refuse, and `existsSync` answers false for one.
		try {
			lstatSync(join(pruned.resourcesDir, name));
			surviving.push(name);
		} catch (error) {
			if (error.code === "ENOENT") continue;
			throw error;
		}
	}
	if (surviving.length > 0) {
		throw new Error(
			`The packaged app still carries legacy Python resource name(s): ${surviving.join(", ")} under ${pruned.resourcesDir}. The interpreter ships as inert data under python-runtime-seed/<arch>, and an incumbent venv naming the old path can reach it there. Fix extraResources rather than deleting the alias after the fact.`,
		);
	}
	return pruned;
}

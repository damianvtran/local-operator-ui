import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

function check(id, target, description, work) {
	try { return { id, target, description, passed: true, output: work() ?? "" }; }
	catch (error) { return { id, target, description, passed: false, output: error.message }; }
}
function contained(root, path) {
	const rel = relative(root, path);
	return rel === "" || (!rel.startsWith("../") && rel !== ".." && !isAbsolute(rel));
}

/** The architecture a release artifact's FILENAME claims.
 *
 * `mac.artifactName` is `${name}-${version}-${arch}.${ext}`, so the name is the
 * only statement about which architecture a container is meant to carry. The
 * app inside it can be read for its own architecture (`lipo`), and for a
 * container the two must agree: a `-x64.zip` whose app is arm64 extracts and
 * launches on the machine that built it and cannot start on the machine it was
 * built for, which is the one failure mode no other check in this gate can see.
 *
 * `null` for a name carrying no architecture (an unpacked `dist` app, a copy
 * taken by hand): the caller then has nothing to cross-check and must not
 * invent one. Never guess - the check that reads this refuses on a mismatch.
 */
export function artifactArch(path) {
	return /-(arm64|x64)\.(?:dmg|zip)$/.exec(basename(path))?.[1] ?? null;
}

/** No compatibility aliases: an incumbent venv must not reach the new signed
 * seed between ShipIt's swap and the candidate's very first instruction.
 * File modes/ACLs are deliberately irrelevant to this namespace guarantee.
 *
 * `expectArch` is the architecture the artifact being checked claims (see
 * `artifactArch`), and it is asserted against the seed's own directory name: a
 * container that carries the other architecture's complete, correct seed is the
 * failure this catches, and it passes every other check in the gate.
 */
export function privatePythonSeedCheck(appPath, { expectArch = null } = {}) {
	return check("app-private-python-seed", appPath, "complete private Python seed with no legacy aliases", () => {
		const resources = join(appPath, "Contents", "Resources");
		for (const legacy of ["python", "python_aarch64"]) {
			try { lstatSync(join(resources, legacy)); }
			catch (error) { if (error.code === "ENOENT") continue; throw error; }
			throw new Error(`Legacy Python resource or alias exists: ${legacy}`);
		}
		const parent = join(resources, "python-runtime-seed");
		const names = readdirSync(parent);
		if (names.length !== 1 || !["arm64", "x64"].includes(names[0])) throw new Error("Expected one architecture-specific private seed");
		if (expectArch != null && names[0] !== expectArch) throw new Error(`The artifact names ${expectArch} but ships the ${names[0]} seed`);
		const root = join(parent, names[0]);
		const rootReal = realpathSync(root);
		if (!lstatSync(root).isDirectory()) throw new Error("Seed root must be a directory, not an alias");
		function walk(directory) {
			for (const name of readdirSync(directory)) {
				const path = join(directory, name);
				const stat = lstatSync(path);
				if (stat.isSymbolicLink()) {
					const target = readlinkSync(path);
					if (isAbsolute(target) || !contained(root, resolve(dirname(path), target)) || !contained(rootReal, realpathSync(path))) throw new Error(`Escaping seed link: ${path}`);
				} else if (stat.isDirectory()) walk(path);
				else if (!stat.isFile() || stat.nlink !== 1) throw new Error(`Hardlink or special file in seed: ${path}`);
			}
		}
		walk(root);
		if (!existsSync(join(root, "bin", "python3")) || !existsSync(join(root, "lib", "python3.12", "encodings", "__init__.py"))) throw new Error("The seed must carry the complete Python runtime, not just its executable");
	});
}

/**
 * What a shipped disk image wants on stdin before it will mount.
 *
 * electron-builder treats `build/license_<lang>.txt` as the image's SLA by
 * convention, so every image this project ships carries one - measured on a real
 * `electron-builder --mac --arm64` output of this branch: a bare `hdiutil
 * attach` printed the agreement and then answered `hdiutil: attach canceled`,
 * exit 1, with no TTY to answer on. The gate would then have reported the app
 * inside the image as unverifiable on every release, which is the row R3 exists
 * for. One `Y` is enough for one language; the prompt is satisfied and the mount
 * continues. Read-only and `-nobrowse` stay, so this never surfaces a volume in
 * the Finder of whoever is running the gate.
 */
const LICENSE_ACCEPTANCE = "Y\n";

/** Check what users receive, not merely electron-builder's unpacked directory.
 * A DMG must be copied out with ditto so the gate tests an installed, writable
 * copy - one real, per-architecture artifact at a time, with the architecture
 * its filename claims handed to `checkApp`. Every mount and extracted tree
 * belongs to this invocation alone.
 */
export function finalContainerChecks(path, { run, checkApp }) {
	const scratch = mkdtempSync(join(tmpdir(), "local-operator-artifact-"));
	const extracted = join(scratch, "extracted");
	mkdirSync(extracted);
	const mount = join(scratch, "mount");
	let mounted = false;
	const results = [];
	const mustRun = (command, args, input) => {
		const result = run(command, args, input);
		if (result.status !== 0) throw new Error(`${command}: ${result.stderr || result.stdout}`);
		return result;
	};
	try {
		if (path.endsWith(".dmg")) {
			mkdirSync(mount);
			mustRun("/usr/bin/hdiutil", ["attach", "-readonly", "-nobrowse", "-mountpoint", mount, path], LICENSE_ACCEPTANCE);
			mounted = true;
			for (const name of readdirSync(mount).filter((name) => name.endsWith(".app"))) {
				mustRun("/usr/bin/ditto", [join(mount, name), join(extracted, name)]);
			}
		} else {
			const listing = mustRun("/usr/bin/unzip", ["-Z1", path]).stdout;
			if (listing.split("\n").some((entry) => isAbsolute(entry) || entry.split("/").includes(".."))) throw new Error("Archive contains an escaping entry");
			mustRun("/usr/bin/ditto", ["-x", "-k", path, extracted]);
		}
		const apps = readdirSync(extracted).filter((name) => name.endsWith(".app"));
		if (apps.length !== 1) throw new Error(`Expected exactly one application in ${basename(path)}`);
		// The filename's architecture travels with the extracted app: the checks
		// below read the app's own architecture, and only the container knows which
		// one the user's download was supposed to be.
		const arch = artifactArch(path);
		for (const app of apps) results.push(...checkApp(join(extracted, app), arch).map((result) => ({ ...result, target: `${path} :: ${app}` })));
	} catch (error) {
		results.push({ id: "final-container-app", target: path, description: "validate the delivered application", passed: false, output: error.message });
	} finally {
		if (mounted) {
			const detached = run("/usr/bin/hdiutil", ["detach", mount]);
			if (detached.status !== 0) {
				// Never recurse into a still-mounted image on cleanup failure.
				results.push({ id: "artifact-unmount", target: mount, description: "detach owned verification mount", passed: false, output: detached.stderr });
				return results;
			}
		}
		rmSync(scratch, { recursive: true, force: true });
	}
	return results;
}

/** Resolve YAML through the same builder dependency as the existing publishing
 * tests. Hash FINAL container bytes (after stapling); never rewrite the feed to
 * make a failed comparison green.
 */
export function finalMetadataChecks(dist, artifacts) {
	const require = createRequire(import.meta.url);
	const builder = createRequire(require.resolve("electron-builder"));
	const library = createRequire(builder.resolve("app-builder-lib"));
	const { load } = library("js-yaml");
	const metadata = readdirSync(dist).filter((name) => /.*-mac.*\.yml$/.test(name));
	const seen = new Set();
	const results = metadata.map((name) => check("final-artifact-metadata", join(dist, name), "release metadata describes exact delivered bytes", () => {
		const document = load(readFileSync(join(dist, name), "utf8"));
		if (!Array.isArray(document.files) || document.files.length === 0) throw new Error("No release files in macOS metadata");
		for (const file of document.files) {
			if (typeof file.url !== "string" || basename(file.url) !== file.url) throw new Error("Metadata file must be a local artifact basename");
			const path = join(dist, file.url);
			const bytes = readFileSync(path);
			const hash = createHash("sha512").update(bytes).digest("base64");
			if (hash !== file.sha512 || bytes.length !== file.size) throw new Error(`Metadata bytes differ: ${file.url}`);
			if (document.path === file.url && document.sha512 !== hash) throw new Error(`Legacy metadata hash differs: ${file.url}`);
			seen.add(file.url);
		}
	}));
	for (const path of artifacts) if (!seen.has(basename(path))) results.push({ id: "final-artifact-metadata", target: path, description: "every delivered container appears in verified metadata", passed: false, output: "No matching verified metadata entry" });
	return results;
}

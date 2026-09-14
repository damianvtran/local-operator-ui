#!/usr/bin/env node
/**
 * The `afterPack` hook: keep only the interpreter tree this build can run, and
 * refuse to ship a legacy resource alias beside the private seed.
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
import { lstatSync } from "node:fs";
import { join } from "node:path";
import pruneAfterPack from "./prune-python-resource.mjs";

/**
 * The legacy resource names a bundle must never carry again.
 *
 * Written out rather than derived: these are the names shipped builds used -
 * `python_aarch64` on arm64, `python` on x64 - and the point of the check is
 * that they stay gone. Deriving them from the seed paths would silently start
 * checking the *new* names instead, which are the ones that must be present.
 */
const LEGACY_PYTHON_RESOURCE_NAMES = ["python", "python_aarch64"];

export default async function afterPack(context) {
	const productFilename = context.packager?.appInfo?.productFilename;
	if (productFilename == null) {
		throw new Error(
			"Cannot prepare the bundled Python: afterPack context has no packager.appInfo.productFilename",
		);
	}
	const pruned = await pruneAfterPack(context);
	if (!pruned.resourcesDir) return pruned;

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

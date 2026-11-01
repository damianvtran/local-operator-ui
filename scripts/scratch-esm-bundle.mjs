import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** Keep generated code outside the checkout without changing external package
 * resolution. The symlink shares the existing dependency tree; it installs or
 * copies nothing. Allocate before building so every failure crosses finally.
 * Abrupt process termination cannot run finally; any residue stays in scratch,
 * never beside source. The caller must still own/reap its process explicitly.
 */
export async function importScratchBundle(
	buildBundle,
	{
		repoRoot,
		scratchRoot = process.env.LOCAL_OPERATOR_SCRATCHPAD ??
			process.env.RUNNER_TEMP ??
			join(homedir(), ".cache", "local-operator-ui", "test-scratch"),
		load = (url) => import(url),
	} = {},
) {
	await mkdir(scratchRoot, { recursive: true });
	const directory = await mkdtemp(join(scratchRoot, "session-load-bundle-"));
	try {
		await symlink(
			join(repoRoot, "node_modules"),
			join(directory, "node_modules"),
			"dir",
		);
		const bundle = await buildBundle();
		const path = join(directory, "bundle.mjs");
		await writeFile(path, bundle.outputFiles[0].text);
		return await load(pathToFileURL(path).href);
	} finally {
		// Only this function's fresh directory is removable, never the symlink's
		// dependency target or the operator's existing scratch contents.
		await rm(directory, { recursive: true, force: true });
	}
}

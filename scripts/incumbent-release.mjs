const METADATA_ASSET = "latest-mac.yml";
const EXACT_TAG = /^v\d+\.\d+\.\d+$/;
const ARCH_IDENTIFIER = /^[a-z0-9]+$/;

function refused(reason, tag, asset = METADATA_ASSET, stage = null) {
	return { ok: false, reason, tag, asset, ...(stage ? { stage } : {}) };
}

function httpFailure(status) {
	return Number.isInteger(status) && status >= 100 && status <= 599
		? `http-${status}`
		: "unexpected-payload";
}

/** Only a readable asset list can establish absence. An API refusal used to
 * look like a release without metadata (for example, a 403 JSON rate-limit
 * response also has no assets). This probe stays unauthenticated by design:
 * the exact-update job must not have credentials. Do not retain response
 * bodies, URLs, status text or exception messages in a refusal. */
export async function resolveIncumbentRelease({
	repo,
	tag,
	fetchImpl = fetch,
}) {
	let response;
	try {
		response = await fetchImpl(
			`https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`,
		);
	} catch {
		return refused("transport-error", tag);
	}
	if (!response.ok) return refused(httpFailure(response.status), tag);

	let release;
	try {
		release = await response.json();
	} catch {
		return refused("unexpected-payload", tag);
	}
	if (
		!Array.isArray(release?.assets) ||
		!release.assets.every((asset) => typeof asset?.name === "string")
	) {
		return refused("unexpected-payload", tag);
	}
	const metadataAsset = release.assets.find(
		({ name }) => name === METADATA_ASSET,
	);
	if (!metadataAsset) return refused("missing-metadata-asset", tag);
	return { ok: true, release, metadataAsset };
}

/** Keep the unauthenticated metadata download and YAML decoder inside the
 * refusal boundary. A transport error can include the asset URL, and a parser
 * diagnostic can include part of the manifest, so neither exception may escape
 * into the verifier's evidence. No local file is needed to read the manifest. */
export async function resolveIncumbentMetadata({
	tag,
	arch,
	release,
	metadataAsset,
	parseMetadata,
	fetchImpl = fetch,
}) {
	const refuseDownload = (reason) =>
		refused(reason, tag, METADATA_ASSET, "metadata");
	const url = metadataAsset.browser_download_url;
	if (typeof url !== "string" || url.length === 0)
		return refuseDownload("unexpected-payload");

	let response;
	try {
		response = await fetchImpl(url);
	} catch {
		return refuseDownload("transport-error");
	}
	if (!response.ok) return refuseDownload(httpFailure(response.status));

	let metadata;
	try {
		metadata = parseMetadata(await response.text());
	} catch {
		return refused("incumbent-metadata-malformed", tag);
	}
	return resolveIncumbentZip({ tag, arch, release, metadata });
}

/** A usable native ZIP must appear in both the downloaded update manifest and
 * the release's published asset list. Report the fixed suffix, not a filename
 * supplied by either response. A malformed manifest cannot prove absence. */
export function resolveIncumbentZip({ tag, arch, release, metadata }) {
	const asset = `-${ARCH_IDENTIFIER.test(arch) ? arch : "unknown"}.zip`;
	if (
		!Array.isArray(metadata?.files) ||
		!metadata.files.every((file) => typeof file?.url === "string")
	) {
		return refused("unexpected-payload", tag, asset);
	}
	const entry = metadata.files.find((file) => file.url.endsWith(asset));
	const zipAsset = release.assets.find(({ name }) => name === entry?.url);
	if (!zipAsset) return refused("missing-arch-zip", tag, asset);
	return { ok: true, entry, zipAsset };
}

/** The formatter consumes only the closed refusal classes above and an exact
 * version tag, never any free-form upstream data. */
export function incumbentReleaseRefusalMessage({ reason, tag, asset, stage }) {
	const release = `The exact incumbent release ${EXACT_TAG.test(tag) ? tag : "(invalid tag)"}`;
	const probe = `(failure class: ${reason}; probed: ${asset}${asset === METADATA_ASSET ? "" : ` in ${METADATA_ASSET}`})`;
	switch (reason) {
		case "missing-metadata-asset":
			return `${release} publishes no ${METADATA_ASSET}; the release asset list was read ${probe}.`;
		case "missing-arch-zip":
			return `${release} has no matching published native-architecture ZIP for ${METADATA_ASSET} ${probe}.`;
		case "incumbent-metadata-malformed":
			return `${release} has unreadable or malformed macOS metadata ${probe}.`;
		case "unexpected-payload":
			return `${release} returned an unreadable or unexpected ${stage === "metadata" ? "macOS metadata asset reference" : asset === METADATA_ASSET ? "release asset list" : "macOS metadata file list"} ${probe}.`;
		default: // transport-error or a numeric HTTP status; neither proves absence.
			return `${release} could not be read from ${stage === "metadata" ? "the macOS metadata asset" : "the GitHub API"} ${probe}. No conclusion about the incumbent or the candidate follows.`;
	}
}

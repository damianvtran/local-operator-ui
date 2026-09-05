/**
 * Radient API surface.
 *
 * Every Radient call goes through the backend's closed proxy (`./proxy`); the
 * old `RadientClient` with a base URL and renderer-held bearer is gone, and
 * with it token exchange, refresh and revoke — those are backend AuthStore
 * concerns. Sign-in runs through the provider grid's backend auth operations.
 */

export {
	createAgent,
	createAgentComment,
	deleteAgent,
	deleteAgentComment,
	favouriteAgent,
	getAgent,
	getAgentDownloadCount,
	getAgentFavourite,
	getAgentFavouriteCount,
	getAgentLike,
	getAgentLikeCount,
	likeAgent,
	listAccountAgents,
	listAgentComments,
	listAgents,
	unfavouriteAgent,
	unlikeAgent,
	updateAgent,
	updateAgentComment,
} from "./agents-api";
export { radientProxy, radientProxyEnvelope } from "./proxy";
export type { RadientOperation, RadientProxyArgs } from "./proxy";
export type * from "./types";

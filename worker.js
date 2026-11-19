import { expireAccountState, fetchAccount } from "./account/worker.mjs";

const HOME = "backchnnl.app";

function isPreview(hostname) {
	return hostname.split(".")[0].endsWith("-backchannel");
}

export default {
	scheduled(_event, env, ctx) {
		ctx.waitUntil(expireAccountState(env.ACCOUNTS_DB));
	},
	async fetch(request, env, ctx) {
		const url = new URL(request.url);
		const accountPath = url.pathname === "/account" || url.pathname.startsWith("/account/");
		if (accountPath && (url.hostname === HOME || url.hostname === "localhost")) {
			return fetchAccount(request, env, url, url.hostname === HOME ? `https://${HOME}` : url.origin, ctx);
		}

		if (url.hostname !== HOME && !isPreview(url.hostname)) {
			return Response.redirect(`https://${HOME}${url.pathname}${url.search}`, 301);
		}

		const response = await env.ASSETS.fetch(request);

		return response.status === 404 ? Response.redirect(new URL("/", url).href, 302) : response;
	},
};

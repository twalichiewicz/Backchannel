const HOME = "backchnnl.app";

function isPreview(hostname) {
	return hostname.split(".")[0].endsWith("-backchannel");
}

export default {
	async fetch(request, env) {
		const url = new URL(request.url);

		if (url.hostname !== HOME && !isPreview(url.hostname)) {
			return Response.redirect(`https://${HOME}${url.pathname}${url.search}`, 301);
		}

		const response = await env.ASSETS.fetch(request);

		return response.status === 404 ? Response.redirect(new URL("/", url).href, 302) : response;
	},
};

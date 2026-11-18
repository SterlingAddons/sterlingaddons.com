// sterlingaddons.com: serves the static site, sends www to the bare domain, and answers /api/versions.

const REPOS = ["SterlingQuest", "SterlingQuestSync-App", "SterlingLoot", "SterlingHunter"];
const VERSION_PAT = /\/releases\/tag\/v(\d+(?:\.\d+){1,3})$/;
const CACHE_SECONDS = 900;

const SECURITY_HEADERS =
{
    "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), interest-cohort=()",
    "Strict-Transport-Security": "max-age=31536000",
};

// The newest release of one repo, read from where github.com/<repo>/releases/latest redirects to (no API rate limit).
async function latestVersion(repo)
{
    const response = await fetch(`https://github.com/SterlingAddons/${repo}/releases/latest`, { redirect: "manual", headers: { "User-Agent": "sterlingaddons.com" } });
    const match = (response.headers.get("Location") || "").match(VERSION_PAT);

    return match ? match[1] : null;
}

// All four versions, cached at the edge for 15 minutes so GitHub is asked rarely.
async function versions(request, ctx)
{
    const cache = caches.default;
    const key = new Request(new URL("/api/versions", request.url).toString());
    const hit = await cache.match(key);

    if (hit) return hit;

    const found = await Promise.all(REPOS.map((repo) => latestVersion(repo).catch(() => null)));
    const body = {};

    REPOS.forEach((repo, i) =>
    {
        if (found[i]) body[repo] = found[i];
    });

    const complete = Object.keys(body).length === REPOS.length;
    const response = new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${complete ? CACHE_SECONDS : 60}` } });

    if (complete) ctx.waitUntil(cache.put(key, response.clone()));

    return response;
}

// Copies a response with the security headers added.
function secure(response)
{
    const out = new Response(response.body, response);

    for (const [name, value] of Object.entries(SECURITY_HEADERS)) out.headers.set(name, value);

    return out;
}

export default
{
    async fetch(request, env, ctx)
    {
        const url = new URL(request.url);

        if (url.hostname.startsWith("www."))
        {
            url.hostname = url.hostname.slice(4);

            return Response.redirect(url.toString(), 301);
        }

        if (url.pathname === "/api/versions") return secure(await versions(request, ctx));

        return secure(await env.ASSETS.fetch(request));
    },
};

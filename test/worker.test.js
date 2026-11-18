// Checks the Worker without Cloudflare: www redirect, version lookup, fallbacks and security headers.
import assert from "node:assert/strict";
import worker from "../src/worker.js";

const stored = new Map();
let githubCalls = 0;
let tags = { SterlingQuest: "v0.3.18", "SterlingQuestSync-App": "v0.1.29", SterlingLoot: "v1.4", SterlingHunter: "v1.7" };

// Fake edge cache.
globalThis.caches =
{
    default:
    {
        match: async (request) => stored.get(request.url)?.clone(),
        put: async (request, response) => stored.set(request.url, response),
    },
};

// Fake github.com: releases/latest redirects to the newest tag.
globalThis.fetch = async (url) =>
{
    githubCalls++;

    const repo = String(url).split("/")[4];
    const tag = tags[repo];

    if (!tag) return new Response("", { status: 404 });

    return new Response(null, { status: 302, headers: { Location: `https://github.com/SterlingAddons/${repo}/releases/tag/${tag}` } });
};

const env = { ASSETS: { fetch: async () => new Response("<html>", { headers: { "Content-Type": "text/html" } }) } };
const ctx = { waitUntil: (promise) => promise };

// www goes to the bare domain, path and query kept.
let response = await worker.fetch(new Request("https://www.sterlingaddons.com/x?y=1"), env, ctx);

assert.equal(response.status, 301);
assert.equal(response.headers.get("Location"), "https://sterlingaddons.com/x?y=1");

// Pages carry the security headers.
response = await worker.fetch(new Request("https://sterlingaddons.com/"), env, ctx);

assert.match(response.headers.get("Content-Security-Policy"), /default-src 'self'/);
assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");

// Versions come from the redirects and are cached.
response = await worker.fetch(new Request("https://sterlingaddons.com/api/versions"), env, ctx);

assert.deepEqual(await response.json(), { SterlingQuest: "0.3.18", "SterlingQuestSync-App": "0.1.29", SterlingLoot: "1.4", SterlingHunter: "1.7" });
assert.equal(githubCalls, 4);

await worker.fetch(new Request("https://sterlingaddons.com/api/versions"), env, ctx);

assert.equal(githubCalls, 4);

// A repo that fails is left out and nothing is cached.
stored.clear();
tags = { ...tags, SterlingHunter: "nightly" };
response = await worker.fetch(new Request("https://sterlingaddons.com/api/versions"), env, ctx);

const partial = await response.json();

assert.equal(partial.SterlingHunter, undefined);
assert.equal(partial.SterlingQuest, "0.3.18");
assert.equal(stored.size, 0);
console.log("worker tests passed");

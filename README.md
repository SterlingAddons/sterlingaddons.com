<p align="center"><img src="site/img/sterling.png" width="96" alt="Sterling icon"></p>

<h1 align="center">sterlingaddons.com</h1>

The landing page for Sterling, a family of add-ons for WoW Forever: [Sterling Quest Sync](https://github.com/SterlingAddons/SterlingQuest), its [Companion app](https://github.com/SterlingAddons/SterlingQuestSync-App), [Loot Tracker](https://github.com/SterlingAddons/SterlingLoot) and [Hunter](https://github.com/SterlingAddons/SterlingHunter).

## How it's built

- One static page in `site/` (HTML, CSS, a little JavaScript), served by a Cloudflare Worker with static assets.
- `src/worker.js` sends `www.` to the bare domain, adds security headers, and answers `/api/versions` with each add-on's newest release (read from GitHub's `releases/latest` redirect, cached for 15 minutes). If that fails, the page keeps the version numbers written in the HTML.
- No cookies, no trackers, nothing loaded from other sites. Fonts (Spectral SC and Source Sans 3, SIL Open Font License) are bundled in `site/fonts/`.
- Screenshots use made-up characters.

## Working on it

- `npm install`, then `npm run dev` for a local copy.
- `npm run check` runs the Worker tests, the code style check and a deploy dry run.
- Code style: 4 spaces, braces on their own line, blank line after a block. `npm install --prefix tools`, then `npm run style`.
- Deploying is `npx wrangler deploy` (custom domains `sterlingaddons.com` and `www.sterlingaddons.com`).

## License

MIT. Built by Sterling with the help of Claude.

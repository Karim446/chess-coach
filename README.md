# Chess Coach 2

A personal chess trainer built from your own chess.com rapid games. Everything runs in your browser; the only server piece is a small function that fetches your games from chess.com.

## Deploy to Cloudflare Pages (PowerShell)

Unzip so that this folder contains `public`, `functions` and `README.md`, then:

```powershell
cd $HOME\Downloads
Expand-Archive .\chess-coach-v2.zip -DestinationPath .\chess-coach-v2 -Force
cd .\chess-coach-v2
dir                      # should list: functions, public, README.md
npx wrangler pages deploy public --project-name chess-coach
```

This replaces the old site on the same address. Open the site and press Ctrl+F5 once.

## What happens on first load

- Your username and solved positions carry over from version 1.
- Your games are downloaded again and re-analyzed once, because the new engine (Stockfish 18) stores more per game. Several engines run in parallel, so this is much faster than before.
- Data now lives in the browser's IndexedDB. Use Settings, Backup to move it between devices.

## What's inside

- `public/index.html`, `public/css`, `public/js`: the app (no build step, plain files)
- `public/engine`: Stockfish 18 lite (WebAssembly), with Stockfish 10 as a fallback, and the GPL license
- `functions/api/chess/[[path]].js`: relays the chess.com game-archive requests and adds the User-Agent chess.com asks for. Optional secret `CONTACT_EMAIL` is included in that header.

No API keys are needed.

## Test locally

```powershell
npx wrangler pages dev public
```

## Updating the site with Git

Every push to `main` deploys automatically through `.github/workflows/deploy.yml`.
The workflow needs two repository secrets (GitHub repo, Settings, Secrets and variables, Actions):

- `CLOUDFLARE_API_TOKEN`: a Cloudflare API token created from the "Edit Cloudflare Workers" template (it includes Pages edit access)
- `CLOUDFLARE_ACCOUNT_ID`: shown on the right side of the Workers & Pages overview in the Cloudflare dashboard

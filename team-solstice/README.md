# Team Solstice — Deployment Guide (corrected)

**Important correction from earlier:** Cloudflare's plain drag-and-drop
"upload assets" flow can only serve static files — it cannot attach
`_worker.js` (the code that fetches Hive stats, checks the admin code, and
talks to KV) as an actual running Worker. That's what the "Variables cannot
be added to a Worker that only has static assets" error meant: your project
had files, but no code was actually attached.

The fix that still avoids installing anything on your computer: push these
files to GitHub (via GitHub's website — no `git` command needed) and let
Cloudflare build from that repo. This uses `wrangler.jsonc`, a config file
that tells Cloudflare "`_worker.js` is the code, everything else is a
static asset."

## 1. Put this folder on GitHub
1. Go to https://github.com and create a free account if you don't have one.
2. Click **New repository** (green button, top right after signing in).
3. Name it `team-solstice`, keep it **Public** or **Private** (either
   works), don't add a README (you already have one) — **Create repository**.
4. On the next page, click **uploading an existing file**.
5. Drag in all five files from this folder: `index.html`, `_worker.js`,
   `wrangler.jsonc`, `.assetsignore`, `README.md`.
   (`.assetsignore` starts with a dot — some file pickers hide dotfiles.
   If it doesn't show up when you drag the folder, drag it in individually.)
6. **Commit changes**.

## 2. Create a KV namespace
1. Cloudflare dashboard → **Storage & Databases → KV** (or **Workers & Pages
   → KV**, depending on what your sidebar shows).
2. **Create namespace**, name it `SOLSTICE_KV`.

## 3. Connect the GitHub repo to Cloudflare
1. Cloudflare dashboard → **Workers & Pages → Create**.
2. Look for **Import a repository** / **Connect to Git** (as opposed to
   "Upload assets," which is the drag-and-drop path that doesn't work here).
3. Authorize GitHub if prompted, then select the `team-solstice` repo.
4. Cloudflare should auto-detect `wrangler.jsonc` and show a build
   configuration — no build command needed, this isn't a compiled project.
5. **Save and Deploy**. First deploy takes a minute or two.

## 4. Bind the KV namespace
1. Open the deployed project → **Settings → Bindings** (or **Variables and
   Secrets**, depending on layout — look for "Bindings").
2. **Add binding → KV namespace**.
3. Variable name: `SOLSTICE_KV` (must match exactly, case-sensitive).
4. Namespace: select the `SOLSTICE_KV` one from step 2.
5. Save.

## 5. Set the admin code
1. Same **Settings** area → **Variables and Secrets → Add**.
2. Type: **Secret**. Variable name: `ADMIN_CODE`. Value: your code.
3. Save.

## 6. Redeploy
Bindings and secrets only take effect on the next deploy. Either:
- push any small change to the GitHub repo (even just re-saving
  `README.md` and committing), which auto-triggers a new deploy, or
- use the **Deployments** tab in Cloudflare → **Retry deployment**.

## 7. Test it
Open the live URL, click **Add Player**, enter your admin code and a real
Hive username, and confirm they show up on the leaderboard.

## If you'd rather use the CLI after all
Honestly, once Node.js is installed, it's three commands and is the
officially recommended path:
```
npm install -g wrangler
wrangler login
wrangler deploy
```
Run `wrangler deploy` from inside this folder. It reads `wrangler.jsonc`
automatically and handles everything above in one step, including asset
upload. The GitHub route above exists purely to avoid that install.

## Notes on the admin code
Still a lightweight shared-secret gate, not full authentication — anyone
with the code can add or remove players. Fine for a small team.

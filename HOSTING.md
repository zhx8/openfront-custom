# Hosting this game online

GitHub stores the code; a host like **Render** builds it from your GitHub
repo, runs the server, and gives you an HTTPS address automatically.

## 1. Put the code on GitHub

1. Create an empty repository on github.com (no README).
2. In this folder:

   ```bash
   git remote add origin https://github.com/YOUR-NAME/YOUR-REPO.git
   git push -u origin main
   ```

The repo must be public: the license (AGPL-3.0) requires players to be able
to get the source code. The footer's GitHub icon links to it (`SOURCE_URL`).

## 2. Deploy on Render

1. Sign up at render.com with your GitHub account.
2. **New > Blueprint**, pick your repo. Render reads `render.yaml`.
3. When asked, fill in:
   - `DOMAIN`: the address Render gives you, e.g. `yourgame.onrender.com`
   - `SOURCE_URL`: your GitHub repo URL
4. Click **Apply**. The first build takes ~10 minutes.

Every `git push` to `main` redeploys automatically.

`render.yaml` uses the **Starter** plan (about $7/month): the free plan
doesn't have enough memory to build the game, and has no disk, so every
account would be wiped on each deploy. Accounts, friends and ratings live in
`/var/data/social.json` on the attached disk. Download a copy now and then
(Render dashboard > Shell: `cat /var/data/social.json`).

## 3. Running it yourself instead

Any machine with Node 24 works the same way. On a network you control,
put it behind a reverse proxy with HTTPS (Caddy does this in two lines).

```bash
npm ci --ignore-scripts
npm run build-prod
GAME_ENV=prod EXTERNAL_API=false PROXY_WORKERS=true PORT=8080 \
NUM_WORKERS=2 INSTANCE_LETTER=a DOMAIN=yourdomain \
TURNSTILE_SITE_KEY=1x00000000000000000000AA \
API_KEY=$(openssl rand -hex 16) ADMIN_BOT_API_KEY=$(openssl rand -hex 16) \
SOCIAL_ADMIN_KEY=$(openssl rand -hex 16) SOURCE_URL=https://github.com/... \
npm run start:server
```

## Admin: bans and password resets

Use the `SOCIAL_ADMIN_KEY` from your host's environment settings.

```bash
# List players
curl -H "x-admin-key: KEY" https://yourgame.onrender.com/api/social/admin/users

# Ban / unban
curl -X POST -H "x-admin-key: KEY" -H "Content-Type: application/json" \
  -d '{"username":"someone"}' https://yourgame.onrender.com/api/social/admin/ban
curl -X POST -H "x-admin-key: KEY" -H "Content-Type: application/json" \
  -d '{"username":"someone"}' https://yourgame.onrender.com/api/social/admin/unban

# Reset a forgotten password (tell them the new one in person)
curl -X POST -H "x-admin-key: KEY" -H "Content-Type: application/json" \
  -d '{"username":"someone","password":"newpass123"}' \
  https://yourgame.onrender.com/api/social/admin/reset-password
```

## Settings reference

| Variable             | What it does                                         |
| -------------------- | ---------------------------------------------------- |
| `EXTERNAL_API=false` | Run without OpenFront's closed-source API (required) |
| `PROXY_WORKERS=true` | Serve everything on one port (no nginx needed)       |
| `PORT`               | Port to listen on (Render sets it)                   |
| `SOCIAL_DATA_FILE`   | Where accounts/friends/ratings are saved             |
| `SOCIAL_ADMIN_KEY`   | Enables the admin endpoints above                    |
| `SOURCE_URL`         | Where the footer's source link points                |

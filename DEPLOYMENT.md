# Deploya TrotLab

Målet är att morbror och andra ska kunna använda appen från mobilen utan att din dator är på — ungefär som [KBTK Check-in](https://github.com/Aurisacrafames-coder/kbtk-checkin), men anpassat för TrotLabs Express-server och SQLite-databas.

KBTK Check-in kör **Vercel + Supabase** (Next.js). TrotLab kör **Railway + volym** eftersom appen behöver en alltid-på server, bakgrundsjobb och en persistent SQLite-fil. Flödet är detsamma: GitHub → automatisk deploy → fast HTTPS-adress.

## 1. GitHub

1. Skapa ett repo, t.ex. `trotlab`, under samma konto som kbtk-checkin.
2. Pusha koden (exkl. `data/` och `.env.local` — de ligger redan i `.gitignore`).

```bash
git init
git add .
git commit -m "Initial TrotLab"
git remote add origin https://github.com/Aurisacrafames-coder/trotlab.git
git push -u origin main
```

## 2. Railway

1. Gå till [railway.app](https://railway.app) och skapa **New Project → GitHub Repo**.
2. Välj `trotlab`-repot.
3. Öppna servicen → **Settings → Networking → Generate Domain** (få t.ex. `https://trotlab-production.up.railway.app`).
4. Lägg till **Volume**:
   - Mount path: `/app/data`
   - Storlek: 1 GB räcker länge
5. Lägg in **Variables**:

```text
NODE_ENV=production
DATA_DIR=/app/data
ACCESS_PASSWORD=välj-eget-lösenord
SITE_URL=https://din-railway-domän.up.railway.app
```

`SITE_URL` ska vara exakt den publika adressen (används av deploy-kontrollen).

Railway sätter `PORT` automatiskt. Bygg- och startkommandon finns i `railway.toml`.

## 3. Kopiera befintlig databas (valfritt)

Om du redan har omgångar lokalt och vill ha med dem:

```bash
railway login
railway link
railway volume add --mount-path /app/data
railway volume files upload data/travkalkyl.db /travkalkyl.db
```

(Efter volymen är kopplad till servicen — filen hamnar i `/app/data/travkalkyl.db`.)

Alternativt: importera omgångarna på nytt via **Importera** i den deployade appen.

## 4. Kontroll före delning

Kör lokalt med produktionsvariablerna i `.env.local`:

```bash
npm run build
npm run check:deploy
```

`check:deploy` ska **inte** användas med `localhost` när appen ska delas till fler.

## 5. Dela

1. Öppna den publika Railway-adressen i webbläsaren.
2. Logga in med lösenordet (`ACCESS_PASSWORD`).
3. Skicka **URL + lösenord** till morbror.

Varje push till `main` deployar om appen automatiskt. Databasen ligger kvar på volymen.

## Tillfällig testlänk (utan Railway)

Om du bara vill testa snabbt utan permanent hosting:

```bash
npm run share
```

Ger en tillfällig Cloudflare-länk som slutar fungera när terminalen stängs.

## Framtida Supabase (valfritt)

Om TrotLab senare flyttas till Supabase Postgres kan appen hostas på Vercel precis som kbtk-checkin. Det kräver att datalagret skrivs om från SQLite — gör det bara om ni behöver exakt samma stack.

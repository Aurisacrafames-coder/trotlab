# TrotLab

Lokal travkalkylator med ATG-import, Trot Score och statistik.

## Dokumentation

- [Deployment](DEPLOYMENT.md) — permanent hosting (liknande flöde som KBTK Check-in)

## Krav

- Node.js 20+

## Starta lokalt

```bash
npm install
npm run dev
```

Öppna http://localhost:5173

API-servern körs på port 3847. SQLite-databasen sparas i `data/travkalkyl.db`.

## Dela tillfälligt (snabbtest)

```bash
npm run share
```

Skapar en tillfällig Cloudflare-länk som fungerar tills du stänger terminalen.

## Permanent hosting

Se [DEPLOYMENT.md](DEPLOYMENT.md). Kort version:

1. Pusha till GitHub
2. Koppla repot till Railway
3. Lägg till volym (`/app/data`) och miljövariabler
4. Dela den publika HTTPS-adressen + lösenord

```bash
npm run build
npm run check:deploy
```

## Användning

1. Gå till **Importera** och klistra in ATG-länkar till avdelningar (samma spelform, datum och bana grupperas automatiskt).
2. Öppna **omgången** på startsidan — se alla avdelningar, topp-score och träff/miss.
3. **Lås omgång** när du lämnat in tips (sparar parametervikter för alla avdelningar).
4. **Hämta alla resultat** efter lopp — eller per avdelning på loppsidan.
5. Justera **viktning** under Inställningar.

## Trot Score

Viktat medelvärde av:

- Startpoäng (auto)
- Kr/start (auto)
- Form — senaste 5 starternas placering (auto)
- Spår idag (auto)
- Kusk vinst% (auto, bakgrundsssync — kusken vinstprocent i spelformen)
- Spel % (auto vid import — andel spelad i avdelningen)
- Spår vinst% bana (auto, bakgrundsssync från ATG)

Skala 0–100.

# WordleBattle

1v1 sanntids multiplayer Wordle. To spillere konkurrerer om å gjette det samme ordet over 5 runder. Første til 3 rundeseire vinner kampen.

## Funksjoner

- Registrering / innlogging med brukernavn, e-post og passord
- Queue-basert matchmaking — ingen invitasjonskoder nødvendig
- Sanntids gameplay via SignalR
- 60 sekunder og 6 gjett per runde
- Rangsystem med 9 nivåer (Bronze til Lexicon God)
- Ledertavle, kamphistorikk og vennesystem
- Profiltilpasning — avatar, ramme, tittel, banner og bio
- Overtid ved uavgjort etter 5 runder — første til å løse vinner kampen

## Teknisk stack

- **Backend**: ASP.NET Core 8, SignalR, Entity Framework Core (SQLite), JWT, BCrypt
- **Frontend**: HTML, CSS, Vanilla JavaScript
- **Hosting**: Railway (auto-deploy fra GitHub)

## Kjør lokalt

Krever .NET 8 SDK.

```bash
dotnet restore
dotnet run
```

Åpne `http://localhost:5000`. Databasen opprettes automatisk ved første kjøring.

## Deploy (Railway)

Prosjektet er satt opp for Railway via GitHub. Push til main og det deployes automatisk.

Sett disse miljøvariablene i Railway:
- `JWT_SECRET` — en vilkårlig lang tilfeldig streng
- `DATA_PATH` — sti til vedvarende volum (f.eks. `/data`)
- `PORT` — settes automatisk av Railway

## Prosjektstruktur
````
WordleBattle/
├── Controllers/     API endpoints (auth, profil, venner)
├── Hubs/            GameHub — SignalR matchmaking og gameplay
├── Models/          Database models og DTOs
├── Services/        AuthService, WordService
├── Data/            EF Core DbContext
├── wwwroot/         Frontend (index.html, css, js)
└── Program.cs       App setup og databaseinitialisering
````

## Spilleregler

- Best av 5 runder — første til 3 rundeseire vinner kampen
- 60 sekunder og 6 gjetninger per runde
- Uavgjort etter 5 runder gir overtime der første riktige gjetning vinner
- Seier: +100–120 poeng / Tap: −50–60 poeng
- Grønn: riktig posisjon — Gul: feil posisjon — Grå: ikke i ordet

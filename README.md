# WordleBattle

1v1 real-time multiplayer Wordle. To spillere konkurrerer om å gjette det samme ordet over 5 runder. Første til 3 rundeseire vinner matchen.

## Funksjoner

- Registrering / innlogging med brukernavn, e-post og passord
- Queue-basert matchmaking — ingen invitasjonskoder nødvendig
- Real-time gameplay via SignalR
- 60 sekunder og 6 gjett per runde
- Rank system med 9 nivåer (Bronze til Lexicon God)
- Leaderboard, match historikk og vennesystem
- Profiltilpasning — avatar, ramme, tittel, banner og bio
- Overtid ved uavgjort etter 5 runder — første til å løse vinner matchen

## Teknisk

- **Backend**: ASP.NET Core 8, SignalR, Entity Framework Core (SQLite), JWT, BCrypt
- **Frontend**: HTML, CSS, Vanilla JavaScript
- **Hosting**: Railway (auto-deploy fra GitHub) — nettside: [wordlebattle.pro](https://wordlebattle.pro)

## Kjør lokalt

Krever .NET 8 SDK.

```bash
dotnet restore
dotnet run
```

Åpne `http://localhost:5000`. Databasen opprettes automatisk ved første kjøring.


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

- Best av 5 runder — første til 3 vinner matchen
- 60 sekunder og 6 gjett per runde
- Uavgjort etter 5 runder blir overtime der første riktige gjett vinner
- Win: +100–120 poeng / Loss: −50–60 poeng
- Grønn: riktig posisjon — Gul: i ordet, men feil posisjon — Grå: ikke i ordet

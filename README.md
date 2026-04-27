# WordleBattle

1v1 real-time multiplayer Wordle. Two players compete to guess the same word across 5 rounds. First to 3 round wins takes the match.

## Features

- Register / login with username, email and password
- Queue-based matchmaking — no invite codes needed
- Real-time gameplay via SignalR
- 60 seconds and 6 guesses per round
- Rank system with 9 tiers (Bronze → Lexicon God)
- Leaderboard, match history and friend system
- Profile customization — avatar, border, title, banner and bio
- Overtime if tied after 5 rounds — first to solve wins the match

## Tech Stack

- **Backend**: ASP.NET Core 8, SignalR, Entity Framework Core (SQLite), JWT, BCrypt
- **Frontend**: HTML, CSS, Vanilla JavaScript
- **Hosting**: Railway (auto-deploy from GitHub)

## Run Locally

Requires .NET 8 SDK.

```bash
dotnet restore
dotnet run
```

Open `http://localhost:5000`. The database is created automatically on first run.

## Deploy (Railway)

The project is set up for Railway via GitHub. Push to main and it deploys automatically.

Set these environment variables in Railway:
- `JWT_SECRET` — any long random string
- `DATA_PATH` — path to persistent volume (e.g. `/data`)
- `PORT` — set automatically by Railway

## Project Structure

```
WordleBattle/
├── Controllers/     API endpoints (auth, profile, friends)
├── Hubs/            GameHub — SignalR matchmaking and gameplay
├── Models/          Database models and DTOs
├── Services/        AuthService, WordService
├── Data/            EF Core DbContext
├── wwwroot/         Frontend (index.html, css, js)
└── Program.cs       App setup and database initialization
```

## Game Rules

- Best of 5 rounds — first to 3 wins takes the match
- 60 seconds and 6 guesses per round
- Tied after 5 rounds → overtime, first correct guess wins
- Win: +100–120 pts / Lose: −50–60 pts
- 🟩 Correct position · 🟨 Wrong position · ⬛ Not in word

---

Built for Fordypningsprosjekt — Gokstad Akademiet

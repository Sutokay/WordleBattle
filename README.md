# Wordle 1v1 - Multiplayer Word Game

Complete authentication system with queue-based matchmaking, real-time gameplay, and AI word generation.

## Features

- **Authentication System**: Register/Login with Username, Email, Password
- **Queue Matchmaking**: Automatic player matching (NO join codes)
- **Real-time Gameplay**: SignalR for instant updates
- **60-Second Timer**: Per round countdown
- **Opponent View**: Miniature board showing opponent progress
- **Best of 5**: First to 3 wins OR most points after 5 rounds
- **AI Word Generation**: Claude API generates random 5-letter words
- **Points System**: Win +10, Lose -5

## Quick Start

### 1. Install .NET 8
```bash
# Check if installed
dotnet --version

# If not, download from: https://dotnet.microsoft.com/download
```

### 2. Setup Database
```bash
cd WordleBattle

# Install EF Core tools (one-time)
dotnet tool install --global dotnet-ef

# Create database
dotnet ef migrations add Initial
dotnet ef database update
```

### 3. Run Locally
```bash
dotnet restore
dotnet run
```

Open browser: `http://localhost:5000`

## How to Play

1. **Register**: Username (3-20 chars), Email, Password (min 6 chars)
2. **Login**: Use your credentials
3. **Play Game**: Click button to enter queue
4. **Find Game**: Automatic matching with another player
5. **Game Start**: Both players get same random 5-letter word
6. **Play Round**: Type guesses, 60 seconds per round
7. **Win**: First to guess correctly OR first to 3 round wins

## Game Rules

- **5 Rounds Total**: Best of 5
- **60 Seconds**: Per round timer
- **6 Guesses**: Maximum attempts per round
- **Scoring**: 
  - Win round = 1 point
  - Win match = +10 points, opponent -5 points
  - Draw round (timeout) = no points

## Color Coding

- **Green**: Correct letter, correct position
- **Yellow**: Correct letter, wrong position
- **Gray**: Letter not in word

## Tech Stack

**Backend:**
- ASP.NET Core 8
- Entity Framework Core (SQLite)
- SignalR (real-time)
- JWT Authentication
- BCrypt password hashing

**Frontend:**
- HTML5, CSS3, Vanilla JavaScript
- SignalR Client

**External:**
- Claude API (word generation & validation)

## Project Structure

```
WordleBattle/
├── Models/
│   ├── User.cs
│   ├── Match.cs
│   └── DTOs/AuthDTOs.cs
├── Data/
│   └── ApplicationDbContext.cs
├── Services/
│   ├── AuthService.cs
│   └── WordService.cs
├── Hubs/
│   └── GameHub.cs (Queue matchmaking)
├── Controllers/
│   └── AuthController.cs
├── wwwroot/
│   ├── index.html
│   ├── css/style.css
│   └── js/game.js
├── Program.cs
└── appsettings.json
```

## Configuration

Edit `appsettings.json`:

```json
{
  "JwtSecret": "your-secret-key-here",
  "ClaudeApiKey": "your-claude-api-key"
}
```

**Get Claude API Key**: https://console.anthropic.com

## Database Schema

**Users:**
- Id, Username (unique), Email (unique), PasswordHash
- Points, Wins, Losses, CreatedAt

**Matches:**
- Id, Player1Id, Player2Id, WinnerId
- Player1Score, Player2Score, Status, CreatedAt

**Rounds:**
- Id, MatchId, RoundNumber, Word, WinnerId
- Player1GuessCount, Player2GuessCount
- StartedAt, CompletedAt

## Deploy to Azure

### 1. Create Resources
```bash
az login

az group create --name WordleRG --location westeurope

az appservice plan create \
  --name WordlePlan \
  --resource-group WordleRG \
  --sku B1 \
  --is-linux

az webapp create \
  --name wordle-yourname \
  --resource-group WordleRG \
  --plan WordlePlan \
  --runtime "DOTNET|8.0"
```

### 2. Set Environment Variables
```bash
az webapp config appsettings set \
  --resource-group WordleRG \
  --name wordle-yourname \
  --settings \
    JwtSecret="your-jwt-secret" \
    ClaudeApiKey="your-claude-key"
```

### 3. Deploy
```bash
dotnet publish -c Release

cd bin/Release/net8.0/publish
zip -r ../deploy.zip .

az webapp deployment source config-zip \
  --resource-group WordleRG \
  --name wordle-yourname \
  --src ../deploy.zip
```

### 4. Access
```
https://wordle-yourname.azurewebsites.net
```

## Troubleshooting

**Database errors:**
```bash
dotnet ef database drop
dotnet ef migrations add Initial
dotnet ef database update
```

**Port already in use:**
Change in `appsettings.json`:
```json
"Urls": "http://localhost:5001"
```

**Authentication fails:**
- Check JwtSecret is set
- Clear browser localStorage
- Re-register user

**Words not generating:**
- Verify Claude API key
- Check API quota
- View console for errors

## Development

**Watch mode:**
```bash
dotnet watch run
```

**View logs:**
```bash
dotnet run --verbosity detailed
```

## License

MIT

## Credits

Built for Emne 9 - Fordypningsprosjekt

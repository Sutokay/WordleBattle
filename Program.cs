using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using System.Text;
using WordleBattle.Data;
using WordleBattle.Hubs;
using WordleBattle.Services;

var builder = WebApplication.CreateBuilder(args);

// JWT secret — prefer env var (production), fall back to appsettings (dev)
var jwtSecret = Environment.GetEnvironmentVariable("JWT_SECRET")
    ?? builder.Configuration["JwtSecret"]
    ?? throw new InvalidOperationException("JWT_SECRET env var or JwtSecret config is required");

// SQLite path — DATA_PATH env var points to a persistent volume on Railway/Fly.io
var dataPath  = Environment.GetEnvironmentVariable("DATA_PATH") ?? "";
var dbFile    = string.IsNullOrEmpty(dataPath)
    ? "wordle.db"
    : Path.Combine(dataPath, "wordle.db");
if (!string.IsNullOrEmpty(dataPath) && !Directory.Exists(dataPath))
    Directory.CreateDirectory(dataPath);

builder.Services.AddDbContext<ApplicationDbContext>(opt =>
    opt.UseSqlite($"Data Source={dbFile}"));

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(opt =>
    {
        opt.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSecret)),
            ValidateIssuer = false,
            ValidateAudience = false,
            ClockSkew = TimeSpan.Zero
        };
        opt.Events = new JwtBearerEvents
        {
            OnMessageReceived = ctx =>
            {
                var token = ctx.Request.Query["access_token"];
                if (!string.IsNullOrEmpty(token) &&
                    ctx.HttpContext.Request.Path.StartsWithSegments("/gamehub"))
                    ctx.Token = token;
                return Task.CompletedTask;
            }
        };
    });

builder.Services.AddAuthorization();
builder.Services.AddHttpClient();
builder.Services.AddScoped<WordService>();
builder.Services.AddScoped<AuthService>();
builder.Services.AddSignalR();
builder.Services.AddControllers();
builder.Services.AddCors(opt => opt.AddPolicy("All",
    p => p.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader()));

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
    db.Database.EnsureCreated();

    db.Database.ExecuteSqlRaw(@"
        CREATE TABLE IF NOT EXISTS UserProfiles (
            Id      INTEGER PRIMARY KEY AUTOINCREMENT,
            UserId  INTEGER NOT NULL UNIQUE,
            Picture TEXT,
            Border  TEXT NOT NULL DEFAULT 'default',
            Title   TEXT NOT NULL DEFAULT '',
            FOREIGN KEY (UserId) REFERENCES Users(Id) ON DELETE CASCADE
        )");

    db.Database.ExecuteSqlRaw(@"
        CREATE TABLE IF NOT EXISTS GuessRecords (
            Id          INTEGER PRIMARY KEY AUTOINCREMENT,
            RoundId     INTEGER NOT NULL,
            UserId      INTEGER NOT NULL,
            Word        TEXT    NOT NULL DEFAULT '',
            Result      TEXT    NOT NULL DEFAULT '',
            IsCorrect   INTEGER NOT NULL DEFAULT 0,
            GuessNumber INTEGER NOT NULL DEFAULT 0,
            GuessedAt   TEXT    NOT NULL DEFAULT '',
            FOREIGN KEY (RoundId) REFERENCES Rounds(Id)  ON DELETE CASCADE,
            FOREIGN KEY (UserId)  REFERENCES Users(Id)   ON DELETE CASCADE
        )");

    try { db.Database.ExecuteSqlRaw("ALTER TABLE UserProfiles ADD COLUMN Bio TEXT NOT NULL DEFAULT ''"); } catch { }
    try { db.Database.ExecuteSqlRaw("ALTER TABLE UserProfiles ADD COLUMN Banner TEXT"); } catch { }
    try { db.Database.ExecuteSqlRaw("ALTER TABLE Matches ADD COLUMN Player1PointsDelta INTEGER NOT NULL DEFAULT 0"); } catch { }
    try { db.Database.ExecuteSqlRaw("ALTER TABLE Matches ADD COLUMN Player2PointsDelta INTEGER NOT NULL DEFAULT 0"); } catch { }

    db.Database.ExecuteSqlRaw(@"
        CREATE TABLE IF NOT EXISTS Friendships (
            Id          INTEGER PRIMARY KEY AUTOINCREMENT,
            RequesterId INTEGER NOT NULL,
            ReceiverId  INTEGER NOT NULL,
            Status      TEXT    NOT NULL DEFAULT 'Pending',
            CreatedAt   TEXT    NOT NULL DEFAULT '',
            FOREIGN KEY (RequesterId) REFERENCES Users(Id) ON DELETE CASCADE,
            FOREIGN KEY (ReceiverId)  REFERENCES Users(Id) ON DELETE CASCADE
        )");
}

app.UseCors("All");
app.UseAuthentication();
app.UseAuthorization();
app.UseDefaultFiles();
app.UseStaticFiles();
app.MapControllers();
app.MapHub<GameHub>("/gamehub");

// Railway / Fly.io inject PORT — bind to it so the reverse-proxy can reach us
var port = Environment.GetEnvironmentVariable("PORT") ?? "5000";
app.Run($"http://+:{port}");

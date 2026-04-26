using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using System.Collections.Concurrent;
using System.Security.Claims;
using WordleBattle.Data;
using WordleBattle.Models;
using WordleBattle.Services;

namespace WordleBattle.Hubs;

[Authorize]
public class GameHub : Hub
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<GameHub> _logger;

    private static IHubContext<GameHub> _hubCtx = null!;

    private static readonly ConcurrentDictionary<string, int> _connToUser = new();
    private static readonly ConcurrentDictionary<int, MatchState> _matches = new();
    private static readonly object _queueLock = new();
    private static readonly List<QueuedPlayer> _queue = new();

    public GameHub(
        IServiceScopeFactory scopeFactory,
        IHubContext<GameHub> hubContext,
        ILogger<GameHub> logger)
    {
        _scopeFactory = scopeFactory;
        _logger       = logger;
        _hubCtx       = hubContext;
    }

    public override async Task OnConnectedAsync()
    {
        var userIdStr = Context.User?.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!int.TryParse(userIdStr, out var userId))
        {
            Context.Abort();
            return;
        }
        _connToUser[Context.ConnectionId] = userId;
        _logger.LogInformation("Connected: user {UserId} conn {Conn}", userId, Context.ConnectionId);
        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? ex)
    {
        if (_connToUser.TryRemove(Context.ConnectionId, out var userId))
        {
            _logger.LogInformation("Disconnected: user {UserId}", userId);

            lock (_queueLock)
                _queue.RemoveAll(p => p.ConnId == Context.ConnectionId);

            var matchEntry = _matches.FirstOrDefault(kv =>
                kv.Value.P1Conn == Context.ConnectionId ||
                kv.Value.P2Conn == Context.ConnectionId);

            if (matchEntry.Value != null)
                _ = HandleDisconnectFromMatch(matchEntry.Key, matchEntry.Value, userId);
        }
        await base.OnDisconnectedAsync(ex);
    }

    private async Task<(int winDelta, int lossDelta)> HandleDisconnectFromMatch(
        int matchId, MatchState md, int disconnectedUserId)
    {
        try
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();

            var m = await db.Matches
                .Include(x => x.Player1)
                .Include(x => x.Player2)
                .FirstOrDefaultAsync(x => x.Id == matchId);

            if (m == null || m.Status == "Completed") return (0, 0);

            m.Status = "Completed";
            m.CompletedAt = DateTime.UtcNow;

            int winnerId  = md.P1UserId == disconnectedUserId ? md.P2UserId : md.P1UserId;
            m.WinnerId    = winnerId;
            int winDelta  = Random.Shared.Next(100, 121);
            int lossDelta = Random.Shared.Next(50,  61);

            if (m.Player1Id == winnerId)
            {
                m.Player1!.Wins++;   m.Player1.Points += winDelta;
                int loserBefore = m.Player2!.Points;
                lossDelta = Math.Min(lossDelta, loserBefore);
                m.Player2.Losses++;  m.Player2.Points = Math.Max(0, loserBefore - lossDelta);
                m.Player1PointsDelta =  winDelta;
                m.Player2PointsDelta = -lossDelta;
            }
            else
            {
                m.Player2!.Wins++;   m.Player2.Points += winDelta;
                int loserBefore = m.Player1!.Points;
                lossDelta = Math.Min(lossDelta, loserBefore);
                m.Player1.Losses++;  m.Player1.Points = Math.Max(0, loserBefore - lossDelta);
                m.Player2PointsDelta =  winDelta;
                m.Player1PointsDelta = -lossDelta;
            }
            await db.SaveChangesAsync();

            if (_matches.TryRemove(matchId, out _))
            {
                var survivorConn = md.P1Conn == Context.ConnectionId ? md.P2Conn : md.P1Conn;
                var survivor     = winnerId == md.P1UserId ? m.Player1 : m.Player2;
                int myScore  = m.Player1Id == winnerId ? m.Player1Score : m.Player2Score;
                int oppScore = m.Player1Id == winnerId ? m.Player2Score : m.Player1Score;
                await _hubCtx.Clients.Client(survivorConn).SendAsync("OpponentDisconnected", new
                {
                    myPoints    = survivor!.Points,
                    myWins      = survivor.Wins,
                    myLosses    = survivor.Losses,
                    myScore,
                    oppScore,
                    pointsDelta = winDelta,
                    rank        = survivor.GetRank(),
                    rankEmoji   = survivor.GetRankEmoji()
                });
            }

            return (winDelta, lossDelta);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error handling disconnect from match {MatchId}", matchId);
            return (0, 0);
        }
    }

    public Task<object> FindGame()
    {
        if (!_connToUser.TryGetValue(Context.ConnectionId, out var userId))
            return Task.FromResult<object>(new { success = false, error = "Not authenticated" });

        _logger.LogInformation("FindGame: user {UserId}", userId);

        QueuedPlayer? p1 = null, p2 = null;
        lock (_queueLock)
        {
            _queue.RemoveAll(p => p.UserId == userId);
            _queue.Add(new QueuedPlayer { UserId = userId, ConnId = Context.ConnectionId });
            _logger.LogInformation("Queue size: {Count}", _queue.Count);

            if (_queue.Count >= 2)
            {
                p1 = _queue[0];
                p2 = _queue[1];
                _queue.RemoveRange(0, 2);
            }
        }

        if (p1 != null && p2 != null)
        {
            _logger.LogInformation("Match found — starting {P1} vs {P2}", p1.UserId, p2.UserId);
            _ = Task.Run(async () =>
            {
                try { await StartMatch(p1, p2); }
                catch (Exception ex) { _logger.LogError(ex, "Unhandled error in StartMatch"); }
            });
        }

        return Task.FromResult<object>(new { success = true });
    }

    public Task<object> CancelQueue()
    {
        if (_connToUser.TryGetValue(Context.ConnectionId, out var userId))
            lock (_queueLock)
                _queue.RemoveAll(p => p.UserId == userId);

        return Task.FromResult<object>(new { success = true });
    }

    public async Task<object> LeaveMatch(int matchId)
    {
        if (!_connToUser.TryGetValue(Context.ConnectionId, out var userId))
            return new { success = false };

        int lossDelta = 0;
        if (_matches.TryGetValue(matchId, out var md) &&
            (md.P1UserId == userId || md.P2UserId == userId))
        {
            _logger.LogInformation("User {UserId} voluntarily left match {MatchId}", userId, matchId);
            (_, lossDelta) = await HandleDisconnectFromMatch(matchId, md, userId);
        }

        using var scope = _scopeFactory.CreateScope();
        var db   = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        var user = await db.Users.FindAsync(userId);
        if (user == null) return new { success = true };

        return new
        {
            success     = true,
            points      = user.Points,
            wins        = user.Wins,
            losses      = user.Losses,
            rank        = user.GetRank(),
            rankEmoji   = user.GetRankEmoji(),
            pointsDelta = -lossDelta
        };
    }

    private async Task StartMatch(QueuedPlayer p1, QueuedPlayer p2)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();

        var u1 = await db.Users.FindAsync(p1.UserId);
        var u2 = await db.Users.FindAsync(p2.UserId);
        if (u1 == null || u2 == null) { _logger.LogWarning("StartMatch: user not found"); return; }

        var match = new Match { Player1Id = u1.Id, Player2Id = u2.Id, Status = "Active" };
        db.Matches.Add(match);
        await db.SaveChangesAsync();

        var group = $"match_{match.Id}";
        await _hubCtx.Groups.AddToGroupAsync(p1.ConnId, group);
        await _hubCtx.Groups.AddToGroupAsync(p2.ConnId, group);

        _matches[match.Id] = new MatchState
        {
            Group    = group,
            P1Conn   = p1.ConnId, P1UserId = p1.UserId,
            P2Conn   = p2.ConnId, P2UserId = p2.UserId
        };

        _logger.LogInformation("Match {MatchId} created, sending MatchFound", match.Id);

        await _hubCtx.Clients.Client(p1.ConnId).SendAsync("MatchFound",
            new { matchId = match.Id, opponent = u2.Username, opponentRankEmoji = u2.GetRankEmoji(),
                  opponentRankName = u2.GetRank(), opponentId = u2.Id, player = 1 });
        await _hubCtx.Clients.Client(p2.ConnId).SendAsync("MatchFound",
            new { matchId = match.Id, opponent = u1.Username, opponentRankEmoji = u1.GetRankEmoji(),
                  opponentRankName = u1.GetRank(), opponentId = u1.Id, player = 2 });

        await Task.Delay(2000);
        await StartRound(match.Id);
    }

    private async Task StartRound(int matchId)
    {
        if (!_matches.ContainsKey(matchId)) return;

        using var scope = _scopeFactory.CreateScope();
        var db          = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        var wordService = scope.ServiceProvider.GetRequiredService<WordService>();

        var m = await db.Matches
            .Include(x => x.Rounds)
            .Include(x => x.Player1)
            .Include(x => x.Player2)
            .FirstOrDefaultAsync(x => x.Id == matchId);

        if (m == null || m.Status == "Completed") return;

        var rNum = m.Rounds.Count + 1;
        if (rNum > 5) { await EndMatch(matchId); return; }

        var word = await wordService.GetRandomWordAsync();
        var r    = new Round { MatchId = matchId, RoundNumber = rNum, Word = word, StartedAt = DateTime.UtcNow };
        db.Rounds.Add(r);
        await db.SaveChangesAsync();

        _logger.LogInformation("Round {Round} started for match {MatchId}, word={Word}", rNum, matchId, word);

        if (_matches.TryGetValue(matchId, out var md))
        {
            await _hubCtx.Clients.Group(md.Group).SendAsync("RoundStart", new
            {
                round    = rNum,
                p1Score  = m.Player1Score,
                p2Score  = m.Player2Score,
                p1Name   = m.Player1!.Username,
                p2Name   = m.Player2!.Username
            });

            var roundId = r.Id;
            _ = Task.Run(async () =>
            {
                try
                {
                    await Task.Delay(61000);
                    await TimeoutRound(roundId);
                }
                catch (Exception ex) { _logger.LogError(ex, "Error in round timeout"); }
            });
        }
    }

    public async Task<object> Guess(int matchId, string word)
    {
        if (!_connToUser.TryGetValue(Context.ConnectionId, out var userId))
            return new { success = false, error = "Not authenticated" };

        if (!_matches.TryGetValue(matchId, out var md))
            return new { success = false, error = "Match not found" };

        if (md.P1UserId != userId && md.P2UserId != userId)
            return new { success = false, error = "Not your match" };

        word = word.ToUpper().Trim();

        using var scope = _scopeFactory.CreateScope();
        var db          = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        var wordService = scope.ServiceProvider.GetRequiredService<WordService>();

        if (!await wordService.IsValidWordAsync(word))
            return new { success = false, error = "Not a valid word" };

        var m = await db.Matches.Include(x => x.Rounds).FirstOrDefaultAsync(x => x.Id == matchId);
        if (m == null) return new { success = false };

        var r = m.Rounds.OrderByDescending(x => x.RoundNumber).FirstOrDefault();
        if (r == null || r.CompletedAt != null)
            return new { success = false, error = "No active round" };

        bool isP1 = m.Player1Id == userId;

        if (isP1  && r.Player1Completed) return new { success = false, error = "You already finished this round" };
        if (!isP1 && r.Player2Completed) return new { success = false, error = "You already finished this round" };

        var  res     = wordService.CheckGuess(word, r.Word);
        bool correct = res.All(c => c == 'G');

        if (isP1) r.Player1GuessCount++;
        else      r.Player2GuessCount++;

        if (correct || (isP1 && r.Player1GuessCount >= 6) || (!isP1 && r.Player2GuessCount >= 6))
        {
            if (isP1) r.Player1Completed = true;
            else      r.Player2Completed = true;
        }

        db.GuessRecords.Add(new GuessRecord
        {
            RoundId     = r.Id,
            UserId      = userId,
            Word        = word,
            Result      = new string(res),
            IsCorrect   = correct,
            GuessNumber = isP1 ? r.Player1GuessCount : r.Player2GuessCount,
            GuessedAt   = DateTime.UtcNow
        });

        await db.SaveChangesAsync();

        await _hubCtx.Clients.Group(md.Group).SendAsync("GuessResult", new
        {
            player  = isP1 ? 1 : 2,
            word,
            result  = new string(res),
            correct
        });

        if (correct)
            _ = Task.Run(async () => { try { await WinRound(r.Id, userId); } catch (Exception ex) { _logger.LogError(ex, "WinRound error"); } });
        else if (r.Player1Completed && r.Player2Completed)
            _ = Task.Run(async () => { try { await TimeoutRound(r.Id); } catch (Exception ex) { _logger.LogError(ex, "TimeoutRound error"); } });

        return new { success = true };
    }

    private async Task WinRound(int roundId, int winnerId)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();

        var r = await db.Rounds
            .Include(x => x.Match).ThenInclude(x => x!.Player1)
            .Include(x => x.Match).ThenInclude(x => x!.Player2)
            .FirstOrDefaultAsync(x => x.Id == roundId);

        if (r == null || r.CompletedAt != null) return;

        r.WinnerId    = winnerId;
        r.CompletedAt = DateTime.UtcNow;

        if (r.Match!.Player1Id == winnerId) r.Match.Player1Score++;
        else                                r.Match.Player2Score++;
        await db.SaveChangesAsync();

        if (_matches.TryGetValue(r.MatchId, out var md))
            await _hubCtx.Clients.Group(md.Group).SendAsync("RoundEnd", new
            {
                winner   = winnerId,
                p1Score  = r.Match.Player1Score,
                p2Score  = r.Match.Player2Score,
                word     = r.Word
            });

        await Task.Delay(3000);

        if (r.Match.Player1Score >= 3 || r.Match.Player2Score >= 3 || r.RoundNumber >= 5)
            await EndMatch(r.MatchId);
        else
            await StartRound(r.MatchId);
    }

    private async Task TimeoutRound(int roundId)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();

        var r = await db.Rounds
            .Include(x => x.Match)
            .FirstOrDefaultAsync(x => x.Id == roundId);

        if (r == null || r.CompletedAt != null) return;

        r.CompletedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();

        if (_matches.TryGetValue(r.MatchId, out var md))
            await _hubCtx.Clients.Group(md.Group).SendAsync("RoundEnd", new
            {
                winner  = (int?)null,
                p1Score = r.Match!.Player1Score,
                p2Score = r.Match.Player2Score,
                word    = r.Word
            });

        await Task.Delay(3000);

        if (r.Match!.Player1Score >= 3 || r.Match.Player2Score >= 3 || r.RoundNumber >= 5)
            await EndMatch(r.MatchId);
        else
            await StartRound(r.MatchId);
    }

    private async Task EndMatch(int matchId)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();

        var m = await db.Matches
            .Include(x => x.Player1)
            .Include(x => x.Player2)
            .FirstOrDefaultAsync(x => x.Id == matchId);

        if (m == null || m.Status == "Completed") return;

        m.Status      = "Completed";
        m.CompletedAt = DateTime.UtcNow;

        int p1Delta = 0, p2Delta = 0;
        int winDelta  = Random.Shared.Next(100, 121);
        int lossDelta = Random.Shared.Next(50,  61);

        var p1 = m.Player1;
        var p2 = m.Player2;
        if (p1 == null || p2 == null) return;

        if (m.Player1Score > m.Player2Score)
        {
            m.WinnerId = m.Player1Id;
            p1Delta =  winDelta;
            p2Delta = -Math.Min(lossDelta, p2.Points);
            p1.Wins++;   p1.Points += winDelta;
            p2.Losses++; p2.Points  = Math.Max(0, p2.Points - lossDelta);
        }
        else if (m.Player2Score > m.Player1Score)
        {
            m.WinnerId = m.Player2Id;
            p2Delta =  winDelta;
            p1Delta = -Math.Min(lossDelta, p1.Points);
            p2.Wins++;   p2.Points += winDelta;
            p1.Losses++; p1.Points  = Math.Max(0, p1.Points - lossDelta);
        }

        m.Player1PointsDelta = p1Delta;
        m.Player2PointsDelta = p2Delta;

        await db.SaveChangesAsync();
        _logger.LogInformation("Match {MatchId} ended. Score {P1}-{P2}", matchId, m.Player1Score, m.Player2Score);

        if (_matches.TryRemove(matchId, out var md))
        {
            await _hubCtx.Clients.Client(md.P1Conn).SendAsync("MatchEnd", new
            {
                winner      = m.WinnerId,
                myScore     = m.Player1Score, oppScore    = m.Player2Score,
                points      = p1.Points,      wins        = p1.Wins, losses = p1.Losses,
                rank        = p1.GetRank(),   rankEmoji   = p1.GetRankEmoji(),
                pointsDelta = p1Delta
            });
            await _hubCtx.Clients.Client(md.P2Conn).SendAsync("MatchEnd", new
            {
                winner      = m.WinnerId,
                myScore     = m.Player2Score, oppScore    = m.Player1Score,
                points      = p2.Points,      wins        = p2.Wins, losses = p2.Losses,
                rank        = p2.GetRank(),   rankEmoji   = p2.GetRankEmoji(),
                pointsDelta = p2Delta
            });
        }
    }
}

public class QueuedPlayer { public int UserId; public string ConnId = ""; }
public class MatchState
{
    public string Group = "";
    public string P1Conn = ""; public int P1UserId;
    public string P2Conn = ""; public int P2UserId;
}

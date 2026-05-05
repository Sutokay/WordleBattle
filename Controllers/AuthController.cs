using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using WordleBattle.Data;
using WordleBattle.Models.DTOs;
using WordleBattle.Services;

namespace WordleBattle.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AuthController : ControllerBase
{
    private readonly AuthService _authService;
    private readonly ApplicationDbContext _db;

    public AuthController(AuthService authService, ApplicationDbContext db)
    {
        _authService = authService;
        _db = db;
    }

    [HttpPost("register")]
    public async Task<IActionResult> Register([FromBody] RegisterRequest request)
    {
        var result = await _authService.Register(request);
        return result.Success ? Ok(result) : BadRequest(result);
    }

    [HttpPost("login")]
    public async Task<IActionResult> Login([FromBody] LoginRequest request)
    {
        var result = await _authService.Login(request);
        return result.Success ? Ok(result) : BadRequest(result);
    }

    [HttpGet("leaderboard")]
    public async Task<IActionResult> Leaderboard()
    {
        var users = await _db.Users
            .OrderByDescending(u => u.Points)
            .Take(100)
            .ToListAsync();

        var userIds  = users.Select(u => u.Id).ToList();
        var profiles = await _db.UserProfiles
            .Where(p => userIds.Contains(p.UserId))
            .ToListAsync();
        var profileMap = profiles.ToDictionary(p => p.UserId);

        var completedMatches = await _db.Matches
            .Where(m => m.Status == "Completed" &&
                        (userIds.Contains(m.Player1Id) ||
                         (m.Player2Id.HasValue && userIds.Contains(m.Player2Id.Value))))
            .Select(m => new { m.Player1Id, m.Player2Id, m.WinnerId, m.CompletedAt })
            .ToListAsync();

        var winsMap   = new Dictionary<int, int>();
        var lossesMap = new Dictionary<int, int>();
        foreach (var m in completedMatches)
        {
            if (!m.WinnerId.HasValue) continue;
            winsMap[m.WinnerId.Value] = winsMap.GetValueOrDefault(m.WinnerId.Value) + 1;
            int loserId = m.Player1Id == m.WinnerId.Value ? (m.Player2Id ?? 0) : m.Player1Id;
            if (loserId > 0)
                lossesMap[loserId] = lossesMap.GetValueOrDefault(loserId) + 1;
        }

        var streakMap = new Dictionary<int, int>();
        foreach (var uid in userIds)
        {
            int streak = 0;
            var userMatches = completedMatches
                .Where(m => m.Player1Id == uid || (m.Player2Id.HasValue && m.Player2Id.Value == uid))
                .OrderByDescending(m => m.CompletedAt);
            foreach (var sm in userMatches)
            {
                if (sm.WinnerId.HasValue && sm.WinnerId.Value == uid) streak++;
                else break;
            }
            streakMap[uid] = streak;
        }

        var result = users.Select((u, i) =>
        {
            profileMap.TryGetValue(u.Id, out var prof);
            int wins   = winsMap.GetValueOrDefault(u.Id);
            int losses = lossesMap.GetValueOrDefault(u.Id);
            int total  = wins + losses;
            return new
            {
                position  = i + 1,
                userId    = u.Id,
                username  = u.Username,
                points    = u.Points,
                wins,
                losses,
                winRate   = total == 0 ? 0 : (int)Math.Round(wins * 100.0 / total),
                streak    = streakMap.GetValueOrDefault(u.Id),
                rank      = u.GetRank(),
                rankEmoji = u.GetRankEmoji(),
                picture   = prof?.Picture,
                border    = prof?.Border ?? "default"
            };
        });

        return Ok(result);
    }

    [HttpGet("recent-matches")]
    [Authorize]
    public async Task<IActionResult> RecentMatches()
    {
        var userIdStr = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!int.TryParse(userIdStr, out var userId)) return Unauthorized();

        var matches = await _db.Matches
            .Include(m => m.Player1)
            .Include(m => m.Player2)
            .Include(m => m.Rounds)
            .Where(m => (m.Player1Id == userId || m.Player2Id == userId)
                        && m.Status == "Completed")
            .OrderByDescending(m => m.CompletedAt)
            .Take(20)
            .ToListAsync();

        var oppIds = matches
            .Select(m => m.Player1Id == userId ? m.Player2Id : m.Player1Id)
            .Where(id => id.HasValue)
            .Select(id => id!.Value)
            .Distinct()
            .ToList();

        var oppProfiles = await _db.UserProfiles
            .Where(p => oppIds.Contains(p.UserId))
            .ToListAsync();
        var oppProfileMap = oppProfiles.ToDictionary(p => p.UserId);

        var result = matches.Select(m =>
        {
            bool   isP1     = m.Player1Id == userId;
            var    opponent  = isP1 ? m.Player2 : m.Player1;
            int    myScore   = isP1 ? m.Player1Score : m.Player2Score;
            int    oppScore  = isP1 ? m.Player2Score : m.Player1Score;
            string outcome   = m.WinnerId == null   ? "DRAW"
                             : m.WinnerId == userId ? "WIN" : "LOSS";
            int    guesses   = m.Rounds.Sum(r => isP1 ? r.Player1GuessCount : r.Player2GuessCount);

            int? oppId     = opponent?.Id;
            oppProfileMap.TryGetValue(oppId ?? 0, out var oppProf);

            int pointsDelta = isP1 ? m.Player1PointsDelta : m.Player2PointsDelta;

            return new
            {
                outcome,
                opponentId      = opponent?.Id,
                opponentName    = opponent?.Username ?? "Unknown",
                opponentRank    = opponent?.GetRankEmoji() ?? "",
                opponentRankName= opponent?.GetRank()      ?? "",
                myScore,
                oppScore,
                totalGuesses    = guesses,
                completedAt     = m.CompletedAt,
                opponentPicture = oppProf?.Picture,
                opponentBorder  = oppProf?.Border ?? "default",
                pointsDelta
            };
        });

        return Ok(result);
    }

    [HttpPut("change-password")]
    [Authorize]
    public async Task<IActionResult> ChangePassword([FromBody] ChangePasswordRequest req)
    {
        var userIdStr = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!int.TryParse(userIdStr, out var userId)) return Unauthorized();

        var user = await _db.Users.FindAsync(userId);
        if (user == null) return Unauthorized();

        if (!BCrypt.Net.BCrypt.Verify(req.CurrentPassword, user.PasswordHash))
            return BadRequest(new { error = "Current password is incorrect" });

        if (string.IsNullOrWhiteSpace(req.NewPassword) || req.NewPassword.Length < 6)
            return BadRequest(new { error = "New password must be at least 6 characters" });

        user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(req.NewPassword);
        await _db.SaveChangesAsync();
        return Ok(new { success = true });
    }

    [HttpPut("change-username")]
    [Authorize]
    public async Task<IActionResult> ChangeUsername([FromBody] ChangeUsernameRequest req)
    {
        var userIdStr = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!int.TryParse(userIdStr, out var userId)) return Unauthorized();

        var name = req.NewUsername?.Trim() ?? "";
        if (name.Length < 3 || name.Length > 20)
            return BadRequest(new { error = "Username must be 3–20 characters" });

        if (await _db.Users.AnyAsync(u => u.Username == name && u.Id != userId))
            return BadRequest(new { error = "Username already taken" });

        var user = await _db.Users.FindAsync(userId);
        if (user == null) return Unauthorized();

        user.Username = name;
        await _db.SaveChangesAsync();
        return Ok(new { success = true, username = user.Username });
    }

    [HttpPut("change-email")]
    [Authorize]
    public async Task<IActionResult> ChangeEmail([FromBody] ChangeEmailRequest req)
    {
        var userIdStr = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!int.TryParse(userIdStr, out var userId)) return Unauthorized();

        var email = req.NewEmail?.Trim() ?? "";
        if (string.IsNullOrEmpty(email) || !email.Contains('@'))
            return BadRequest(new { error = "Invalid email address" });

        if (await _db.Users.AnyAsync(u => u.Email == email && u.Id != userId))
            return BadRequest(new { error = "Email already in use" });

        var user = await _db.Users.FindAsync(userId);
        if (user == null) return Unauthorized();

        user.Email = email;
        await _db.SaveChangesAsync();
        return Ok(new { success = true });
    }

    [HttpDelete("account")]
    [Authorize]
    public async Task<IActionResult> DeleteAccount()
    {
        var userIdStr = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!int.TryParse(userIdStr, out var userId)) return Unauthorized();

        var user = await _db.Users.FindAsync(userId);
        if (user == null) return Unauthorized();

        await _db.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM GuessRecords WHERE UserId = {userId}");
        await _db.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM Friendships WHERE RequesterId = {userId} OR ReceiverId = {userId}");
        await _db.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM UserProfiles WHERE UserId = {userId}");
        await _db.Database.ExecuteSqlInterpolatedAsync($@"
            DELETE FROM GuessRecords WHERE RoundId IN
            (SELECT Id FROM Rounds WHERE MatchId IN
            (SELECT Id FROM Matches WHERE Player1Id = {userId} OR Player2Id = {userId}))");
        await _db.Database.ExecuteSqlInterpolatedAsync($@"
            DELETE FROM Rounds WHERE MatchId IN
            (SELECT Id FROM Matches WHERE Player1Id = {userId} OR Player2Id = {userId})");
        await _db.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM Matches WHERE Player1Id = {userId} OR Player2Id = {userId}");

        _db.Users.Remove(user);
        await _db.SaveChangesAsync();
        return Ok(new { success = true });
    }

    [HttpPost("forgot-password")]
    public async Task<IActionResult> ForgotPassword([FromBody] ForgotPasswordRequest req)
    {
        var username = req.Username?.Trim() ?? "";
        var email    = req.Email?.Trim()    ?? "";

        if (string.IsNullOrEmpty(username) || string.IsNullOrEmpty(email))
            return BadRequest(new { error = "Username and email are required" });

        var user = await _db.Users.FirstOrDefaultAsync(
            u => u.Username == username && u.Email == email);

        if (user == null)
            return BadRequest(new { error = "No account found with that username and email" });

        const string chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
        var rng = new Random();
        var tempPassword = new string(
            Enumerable.Range(0, 10).Select(_ => chars[rng.Next(chars.Length)]).ToArray());

        user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(tempPassword);
        await _db.SaveChangesAsync();

        return Ok(new { success = true, tempPassword });
    }

    [HttpGet("verify")]
    [Authorize]
    public async Task<IActionResult> Verify()
    {
        var userIdStr = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!int.TryParse(userIdStr, out var userId))
            return Unauthorized();

        var userData = await _authService.GetUser(userId);
        if (userData == null) return Unauthorized();

        return Ok(new AuthResponse { Success = true, User = userData });
    }
}

using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using WordleBattle.Data;
using WordleBattle.Models;

namespace WordleBattle.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class ProfileController : ControllerBase
{
    private readonly ApplicationDbContext _db;
    public ProfileController(ApplicationDbContext db) => _db = db;

    private int GetUserId()
    {
        var s = User.FindFirstValue(ClaimTypes.NameIdentifier);
        return int.TryParse(s, out var id) ? id : 0;
    }

    // ── GET /api/profile  (own profile, authorised) ───────────────────────────
    [HttpGet]
    public async Task<IActionResult> GetProfile()
    {
        var userId = GetUserId();
        if (userId == 0) return Unauthorized();

        var user = await _db.Users.FindAsync(userId);
        if (user == null) return Unauthorized();

        // Get or create profile row
        var profile = await _db.UserProfiles.FirstOrDefaultAsync(p => p.UserId == userId);
        if (profile == null)
        {
            profile = new UserProfile { UserId = userId };
            _db.UserProfiles.Add(profile);
            await _db.SaveChangesAsync();
        }

        var userMatches = await _db.Matches
            .Where(m => (m.Player1Id == userId || m.Player2Id == userId)
                        && m.Status == "Completed")
            .ToListAsync();

        int wins   = userMatches.Count(m => m.WinnerId == userId);
        int losses = userMatches.Count(m => m.WinnerId != null && m.WinnerId != userId);

        var guesses = await _db.GuessRecords
            .Where(g => g.UserId == userId)
            .ToListAsync();

        var correct        = guesses.Where(g => g.IsCorrect).ToList();
        double avgGuesses  = correct.Any() ? correct.Average(g => g.GuessNumber) : 0;
        int    fastestSolve = correct.Any() ? correct.Min(g => g.GuessNumber)     : 0;

        var topLetters = guesses
            .SelectMany(g => g.Word.ToCharArray())
            .GroupBy(c => c)
            .OrderByDescending(g => g.Count())
            .Take(5)
            .Select(g => new { letter = g.Key.ToString(), count = g.Count() })
            .ToList();

        var commonFirstGuess = guesses
            .Where(g => g.GuessNumber == 1)
            .GroupBy(g => g.Word)
            .OrderByDescending(g => g.Count())
            .Select(g => (string?)g.Key)
            .FirstOrDefault();

        var favoriteWord = guesses
            .GroupBy(g => g.Word)
            .OrderByDescending(g => g.Count())
            .Select(g => (string?)g.Key)
            .FirstOrDefault();

        var matchesByDate = userMatches
            .OrderByDescending(m => m.CompletedAt)
            .ToList();

        int currentStreak = 0;
        foreach (var m in matchesByDate)
        {
            if (m.WinnerId == userId) currentStreak++;
            else break;
        }

        int bestStreak = 0, tempStreak = 0;
        foreach (var m in Enumerable.Reverse(matchesByDate))
        {
            if (m.WinnerId == userId) { tempStreak++; if (tempStreak > bestStreak) bestStreak = tempStreak; }
            else tempStreak = 0;
        }

        return Ok(new
        {
            picture       = profile.Picture,
            banner        = profile.Banner,
            border        = profile.Border,
            title         = profile.Title,
            bio           = profile.Bio,
            stats         = new
            {
                wins,
                losses,
                points        = user.Points,
                avgGuesses    = Math.Round(avgGuesses, 1),
                fastestSolve,
                currentStreak,
                bestStreak,
                totalGuesses  = guesses.Count
            },
            topLetters,
            commonFirstGuess,
            favoriteWord
        });
    }

    // ── GET /api/profile/{userId}  (public — no auth required) ───────────────
    [HttpGet("{userId:int}")]
    [AllowAnonymous]
    public async Task<IActionResult> GetPublicProfile(int userId)
    {
        var user = await _db.Users.FindAsync(userId);
        if (user == null) return NotFound();

        var profile  = await _db.UserProfiles.FirstOrDefaultAsync(p => p.UserId == userId);
        var matches  = await _db.Matches
            .Where(m => (m.Player1Id == userId || m.Player2Id == userId) && m.Status == "Completed")
            .ToListAsync();

        int wins   = matches.Count(m => m.WinnerId == userId);
        int losses = matches.Count(m => m.WinnerId != null && m.WinnerId != userId);
        int total  = wins + losses;

        var ordered  = matches.OrderByDescending(m => m.CompletedAt).ToList();
        int streak   = 0;
        foreach (var m in ordered) { if (m.WinnerId == userId) streak++; else break; }

        return Ok(new
        {
            userId    = user.Id,
            username  = user.Username,
            rank      = user.GetRank(),
            rankEmoji = user.GetRankEmoji(),
            points    = user.Points,
            wins,
            losses,
            winRate   = total == 0 ? 0 : (int)Math.Round(wins * 100.0 / total),
            streak,
            picture   = profile?.Picture,
            banner    = profile?.Banner,
            border    = profile?.Border ?? "default",
            title     = profile?.Title  ?? "",
            bio       = profile?.Bio    ?? ""
        });
    }

    // ── GET /api/profile/find/{username}  (search by name, no auth) ──────────
    [HttpGet("find/{username}")]
    [AllowAnonymous]
    public async Task<IActionResult> FindByUsername(string username)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Username.ToLower() == username.ToLower());
        if (user == null) return NotFound(new { error = "User not found" });
        return await GetPublicProfile(user.Id);
    }

    // ── PUT /api/profile/picture ──────────────────────────────────────────────
    [HttpPut("picture")]
    public async Task<IActionResult> UpdatePicture([FromBody] PictureRequest req)
    {
        var userId = GetUserId();
        if (userId == 0) return Unauthorized();

        if (req.Picture != null && req.Picture.Length > 200_000)
            return BadRequest(new { error = "Image too large (max ~150 KB)" });

        var profile = await _db.UserProfiles.FirstOrDefaultAsync(p => p.UserId == userId);
        if (profile == null)
        {
            profile = new UserProfile { UserId = userId };
            _db.UserProfiles.Add(profile);
        }

        profile.Picture = req.Picture;
        await _db.SaveChangesAsync();
        return Ok(new { success = true });
    }

    // ── PUT /api/profile/bio ──────────────────────────────────────────────────
    [HttpPut("bio")]
    public async Task<IActionResult> UpdateBio([FromBody] BioRequest req)
    {
        var userId = GetUserId();
        if (userId == 0) return Unauthorized();

        var bio = (req.Bio ?? "").Trim();
        if (bio.Length > 100) bio = bio[..100];

        var profile = await _db.UserProfiles.FirstOrDefaultAsync(p => p.UserId == userId);
        if (profile == null)
        {
            profile = new UserProfile { UserId = userId };
            _db.UserProfiles.Add(profile);
        }

        profile.Bio = bio;
        await _db.SaveChangesAsync();
        return Ok(new { success = true });
    }

    // ── PUT /api/profile/customization ────────────────────────────────────────
    [HttpPut("customization")]
    public async Task<IActionResult> UpdateCustomization([FromBody] CustomizationRequest req)
    {
        var userId = GetUserId();
        if (userId == 0) return Unauthorized();

        var profile = await _db.UserProfiles.FirstOrDefaultAsync(p => p.UserId == userId);
        if (profile == null)
        {
            profile = new UserProfile { UserId = userId };
            _db.UserProfiles.Add(profile);
        }

        if (req.Border  != null) profile.Border  = req.Border;
        if (req.Title   != null) profile.Title   = req.Title;
        if (req.Banner  != null) profile.Banner  = req.Banner;

        await _db.SaveChangesAsync();
        return Ok(new { success = true });
    }
}

public class PictureRequest       { public string? Picture { get; set; } }
public class BioRequest           { public string? Bio     { get; set; } }
public class CustomizationRequest { public string? Border { get; set; } public string? Title { get; set; } public string? Banner { get; set; } }

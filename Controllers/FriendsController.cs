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
public class FriendsController : ControllerBase
{
    private readonly ApplicationDbContext _db;
    public FriendsController(ApplicationDbContext db) => _db = db;

    private int GetUserId()
    {
        var s = User.FindFirstValue(ClaimTypes.NameIdentifier);
        return int.TryParse(s, out var id) ? id : 0;
    }

    [HttpGet]
    public async Task<IActionResult> GetFriends()
    {
        var userId = GetUserId();
        if (userId == 0) return Unauthorized();

        var friendships = await _db.Friendships
            .Include(f => f.Requester)
            .Include(f => f.Receiver)
            .Where(f => (f.RequesterId == userId || f.ReceiverId == userId) && f.Status == "Accepted")
            .ToListAsync();

        var friendIds = friendships
            .Select(f => f.RequesterId == userId ? f.ReceiverId : f.RequesterId)
            .ToList();

        var profiles = await _db.UserProfiles
            .Where(p => friendIds.Contains(p.UserId))
            .ToListAsync();
        var profileMap = profiles.ToDictionary(p => p.UserId);

        var result = friendships.Select(f =>
        {
            var friend = f.RequesterId == userId ? f.Receiver! : f.Requester!;
            profileMap.TryGetValue(friend.Id, out var prof);
            return new
            {
                friendshipId = f.Id,
                userId       = friend.Id,
                username     = friend.Username,
                rank         = friend.GetRank(),
                rankEmoji    = friend.GetRankEmoji(),
                points       = friend.Points,
                picture      = prof?.Picture,
                border       = prof?.Border ?? "default"
            };
        });

        return Ok(result);
    }

    [HttpGet("requests")]
    public async Task<IActionResult> GetRequests()
    {
        var userId = GetUserId();
        if (userId == 0) return Unauthorized();

        var requests = await _db.Friendships
            .Include(f => f.Requester)
            .Where(f => f.ReceiverId == userId && f.Status == "Pending")
            .ToListAsync();

        var requesterIds = requests.Select(f => f.RequesterId).ToList();
        var profiles     = await _db.UserProfiles.Where(p => requesterIds.Contains(p.UserId)).ToListAsync();
        var profileMap   = profiles.ToDictionary(p => p.UserId);

        var result = requests.Select(f =>
        {
            profileMap.TryGetValue(f.RequesterId, out var prof);
            return new
            {
                friendshipId = f.Id,
                userId       = f.RequesterId,
                username     = f.Requester!.Username,
                rank         = f.Requester.GetRank(),
                rankEmoji    = f.Requester.GetRankEmoji(),
                points       = f.Requester.Points,
                picture      = prof?.Picture,
                border       = prof?.Border ?? "default"
            };
        });

        return Ok(result);
    }

    [HttpGet("status/{targetId:int}")]
    public async Task<IActionResult> GetStatus(int targetId)
    {
        var userId = GetUserId();
        if (userId == 0) return Unauthorized();

        var f = await _db.Friendships.FirstOrDefaultAsync(f =>
            (f.RequesterId == userId && f.ReceiverId == targetId) ||
            (f.RequesterId == targetId && f.ReceiverId == userId));

        if (f == null) return Ok(new { status = "none", friendshipId = (int?)null });
        if (f.Status == "Accepted") return Ok(new { status = "friends",          friendshipId = (int?)f.Id });
        if (f.RequesterId == userId) return Ok(new { status = "pending_sent",    friendshipId = (int?)f.Id });
        return Ok(new { status = "pending_received", friendshipId = (int?)f.Id });
    }

    [HttpPost("request")]
    public async Task<IActionResult> SendRequest([FromBody] FriendRequestDto req)
    {
        var userId = GetUserId();
        if (userId == 0) return Unauthorized();

        var name   = req.Username?.Trim() ?? "";
        var target = await _db.Users.FirstOrDefaultAsync(u => u.Username.ToLower() == name.ToLower());
        if (target == null) return BadRequest(new { error = "User not found" });
        if (target.Id == userId) return BadRequest(new { error = "Cannot add yourself" });

        var existing = await _db.Friendships.FirstOrDefaultAsync(f =>
            (f.RequesterId == userId && f.ReceiverId == target.Id) ||
            (f.RequesterId == target.Id && f.ReceiverId == userId));

        if (existing != null)
        {
            if (existing.Status == "Accepted") return BadRequest(new { error = "Already friends" });
            return BadRequest(new { error = "Friend request already exists" });
        }

        _db.Friendships.Add(new Friendship
        {
            RequesterId = userId,
            ReceiverId  = target.Id,
            CreatedAt   = DateTime.UtcNow
        });
        await _db.SaveChangesAsync();
        return Ok(new { success = true });
    }

    [HttpPost("accept/{friendshipId:int}")]
    public async Task<IActionResult> AcceptRequest(int friendshipId)
    {
        var userId = GetUserId();
        if (userId == 0) return Unauthorized();

        var f = await _db.Friendships.FirstOrDefaultAsync(f =>
            f.Id == friendshipId && f.ReceiverId == userId && f.Status == "Pending");
        if (f == null) return NotFound();

        f.Status = "Accepted";
        await _db.SaveChangesAsync();
        return Ok(new { success = true });
    }

    [HttpDelete("{friendshipId:int}")]
    public async Task<IActionResult> Remove(int friendshipId)
    {
        var userId = GetUserId();
        if (userId == 0) return Unauthorized();

        var f = await _db.Friendships.FirstOrDefaultAsync(f =>
            f.Id == friendshipId && (f.RequesterId == userId || f.ReceiverId == userId));
        if (f == null) return NotFound();

        _db.Friendships.Remove(f);
        await _db.SaveChangesAsync();
        return Ok(new { success = true });
    }
}

public class FriendRequestDto { public string Username { get; set; } = ""; }

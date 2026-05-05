using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using WordleBattle.Data;
using WordleBattle.Models;
using WordleBattle.Models.DTOs;

namespace WordleBattle.Services;

public class AuthService
{
    private readonly ApplicationDbContext _db;
    private readonly IConfiguration _config;

    public AuthService(ApplicationDbContext db, IConfiguration config)
    {
        _db = db;
        _config = config;
    }

    public async Task<AuthResponse> Register(RegisterRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Username) || request.Username.Length < 3 || request.Username.Length > 20)
            return new AuthResponse { Success = false, Error = "Username must be 3-20 characters" };

        for (int i = 0; i <= request.Username.Length - 4; i++)
        {
            if (request.Username[i] == request.Username[i + 1] &&
                request.Username[i + 1] == request.Username[i + 2] &&
                request.Username[i + 2] == request.Username[i + 3])
                return new AuthResponse { Success = false, Error = "No more than 3 of the same letter in a row" };
        }

        if (string.IsNullOrWhiteSpace(request.Email) || !request.Email.Contains('@'))
            return new AuthResponse { Success = false, Error = "Invalid email" };

        if (string.IsNullOrWhiteSpace(request.Password) || request.Password.Length < 6)
            return new AuthResponse { Success = false, Error = "Password must be at least 6 characters" };

        if (await _db.Users.AnyAsync(u => u.Username == request.Username))
            return new AuthResponse { Success = false, Error = "Username taken" };

        if (await _db.Users.AnyAsync(u => u.Email == request.Email))
            return new AuthResponse { Success = false, Error = "Email already registered" };

        var user = new User
        {
            Username = request.Username,
            Email = request.Email,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.Password, workFactor: 10)
        };

        _db.Users.Add(user);
        await _db.SaveChangesAsync();

        return new AuthResponse { Success = true, Token = GenerateToken(user), User = ToUserData(user) };
    }

    public async Task<AuthResponse> Login(LoginRequest request)
    {
        var lower = request.Username.ToLower();
        var user  = await _db.Users.FirstOrDefaultAsync(u => u.Username.ToLower() == lower);

        if (user == null || !BCrypt.Net.BCrypt.Verify(request.Password, user.PasswordHash))
            return new AuthResponse { Success = false, Error = "Invalid credentials" };

        return new AuthResponse { Success = true, Token = GenerateToken(user), User = ToUserData(user) };
    }

    public async Task<UserData?> GetUser(int userId)
    {
        var user = await _db.Users.FindAsync(userId);
        return user == null ? null : ToUserData(user);
    }

    private string GenerateToken(User user)
    {
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_config["JwtSecret"]!));
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new Claim(ClaimTypes.Name, user.Username)
        };

        var token = new JwtSecurityToken(
            claims: claims,
            expires: DateTime.UtcNow.AddDays(7),
            signingCredentials: creds
        );

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    private static UserData ToUserData(User user) => new()
    {
        Id = user.Id,
        Username = user.Username,
        Email = user.Email,
        Points = user.Points,
        Wins = user.Wins,
        Losses = user.Losses,
        Rank = user.GetRank(),
        RankEmoji = user.GetRankEmoji()
    };
}

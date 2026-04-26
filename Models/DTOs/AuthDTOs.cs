namespace WordleBattle.Models.DTOs;

public class RegisterRequest
{
    public string Username { get; set; } = "";
    public string Email { get; set; } = "";
    public string Password { get; set; } = "";
}

public class LoginRequest
{
    public string Username { get; set; } = "";
    public string Password { get; set; } = "";
}

public class AuthResponse
{
    public bool Success { get; set; }
    public string? Error { get; set; }
    public string? Token { get; set; }
    public UserData? User { get; set; }
}

public class UserData
{
    public int Id { get; set; }
    public string Username { get; set; } = "";
    public string Email { get; set; } = "";
    public int Points { get; set; }
    public int Wins { get; set; }
    public int Losses { get; set; }
    public string Rank { get; set; } = "";
    public string RankEmoji { get; set; } = "";
}

public class ChangePasswordRequest { public string CurrentPassword { get; set; } = ""; public string NewPassword { get; set; } = ""; }
public class ChangeUsernameRequest { public string NewUsername { get; set; } = ""; }
public class ChangeEmailRequest    { public string NewEmail    { get; set; } = ""; }

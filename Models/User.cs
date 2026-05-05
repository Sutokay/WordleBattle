namespace WordleBattle.Models;

public class User
{
    public int Id { get; set; }
    public string Username { get; set; } = "";
    public string Email { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    public int Points { get; set; } = 0;
    public int Wins { get; set; } = 0;
    public int Losses { get; set; } = 0;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public string GetRank()
    {
        return Points switch
        {
            >= 8000 => "Lexicon God",
            >= 7000 => "Grandmaster",
            >= 6000 => "Master",
            >= 5000 => "Champion",
            >= 4000 => "Diamond",
            >= 3000 => "Platinum",
            >= 2000 => "Gold",
            >= 1000 => "Silver",
            _       => "Bronze"
        };
    }

    public string GetRankEmoji()
    {
        return Points switch
        {
            >= 8000 => "LG",
            >= 7000 => "GM",
            >= 6000 => "MST",
            >= 5000 => "CHP",
            >= 4000 => "DMD",
            >= 3000 => "PLT",
            >= 2000 => "GLD",
            >= 1000 => "SLV",
            _       => "BRZ"
        };
    }

}

namespace WordleBattle.Models;

public class Match
{
    public int Id { get; set; }
    public int Player1Id { get; set; }
    public int? Player2Id { get; set; }
    public int? WinnerId { get; set; }
    public int Player1Score { get; set; } = 0;
    public int Player2Score { get; set; } = 0;
    public string Status { get; set; } = "Active";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? CompletedAt { get; set; }

    public int Player1PointsDelta { get; set; } = 0;
    public int Player2PointsDelta { get; set; } = 0;

    public User? Player1 { get; set; }
    public User? Player2 { get; set; }
    public User? Winner { get; set; }
    public List<Round> Rounds { get; set; } = new();
}

public class Round
{
    public int Id { get; set; }
    public int MatchId { get; set; }
    public int RoundNumber { get; set; }
    public string Word { get; set; } = "";
    public int? WinnerId { get; set; }
    public int Player1GuessCount { get; set; } = 0;
    public int Player2GuessCount { get; set; } = 0;
    public bool Player1Completed { get; set; } = false;
    public bool Player2Completed { get; set; } = false;
    public DateTime StartedAt { get; set; } = DateTime.UtcNow;
    public DateTime? CompletedAt { get; set; }

    public Match? Match { get; set; }
    public User? Winner { get; set; }
}

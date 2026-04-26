namespace WordleBattle.Models;

public class GuessRecord
{
    public int      Id          { get; set; }
    public int      RoundId     { get; set; }
    public int      UserId      { get; set; }
    public string   Word        { get; set; } = "";
    public string   Result      { get; set; } = "";   // e.g. "GXYXG"
    public bool     IsCorrect   { get; set; }
    public int      GuessNumber { get; set; }
    public DateTime GuessedAt   { get; set; } = DateTime.UtcNow;

    public Round? Round { get; set; }
    public User?  User  { get; set; }
}

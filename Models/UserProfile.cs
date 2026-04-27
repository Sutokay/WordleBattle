namespace WordleBattle.Models;

public class UserProfile
{
    public int     Id      { get; set; }
    public int     UserId  { get; set; }
    public string? Picture { get; set; }
    public string  Border  { get; set; } = "default";
    public string  Title   { get; set; } = "";
    public string  Bio     { get; set; } = "";
    public string? Banner   { get; set; }
    public string? Settings { get; set; }
    public User?   User     { get; set; }
}

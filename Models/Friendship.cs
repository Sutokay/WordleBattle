namespace WordleBattle.Models;

public class Friendship
{
    public int Id { get; set; }
    public int RequesterId { get; set; }
    public int ReceiverId { get; set; }
    public string Status { get; set; } = "Pending";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public User? Requester { get; set; }
    public User? Receiver { get; set; }
}

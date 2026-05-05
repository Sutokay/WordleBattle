namespace WordleBattle.Services;

public class WordService
{
    private static readonly HashSet<string> _validWords;
    private static readonly string[] _answerWords;
    private readonly HashSet<string> _usedWords = new();

    static WordService()
    {
        var basePath     = AppContext.BaseDirectory;
        var wordlistPath = Path.Combine(basePath, "Data", "wordlist.txt");

        if (!File.Exists(wordlistPath))
            wordlistPath = Path.Combine(Directory.GetCurrentDirectory(), "Data", "wordlist.txt");

        if (File.Exists(wordlistPath))
        {
            var allWords = File.ReadAllLines(wordlistPath)
                .Select(w => w.Trim().ToUpper())
                .Where(w => w.Length == 5 && w.All(c => c >= 'A' && c <= 'Z'))
                .Distinct()
                .ToArray();

            _validWords  = new HashSet<string>(allWords, StringComparer.OrdinalIgnoreCase);
            _answerWords = allWords.Where(w => IsCommonWord(w)).ToArray();

            if (_answerWords.Length == 0)
                _answerWords = allWords;
        }
        else
        {
            _validWords  = new HashSet<string>(FallbackWords, StringComparer.OrdinalIgnoreCase);
            _answerWords = FallbackWords;
        }
    }

    private static bool IsCommonWord(string w)
    {
        const string vowels = "AEIOU";
        return w.Count(c => vowels.Contains(c)) >= 1;
    }

    public Task<string> GetRandomWordAsync()
    {
        var available = _answerWords.Where(w => !_usedWords.Contains(w)).ToArray();
        if (available.Length == 0)
        {
            _usedWords.Clear();
            available = _answerWords;
        }
        var word = available[Random.Shared.Next(available.Length)];
        _usedWords.Add(word);
        return Task.FromResult(word);
    }

    public Task<bool> IsValidWordAsync(string word)
    {
        word = word.ToUpper().Trim();
        if (word.Length != 5 || !word.All(c => c >= 'A' && c <= 'Z'))
            return Task.FromResult(false);

        return Task.FromResult(_validWords.Contains(word));
    }

    public char[] CheckGuess(string guess, string target)
    {
        guess  = guess.ToUpper();
        target = target.ToUpper();

        var result = new char[5];
        var used   = new bool[5];

        for (int i = 0; i < 5; i++)
        {
            if (guess[i] == target[i])
            {
                result[i] = 'G';
                used[i]   = true;
            }
        }

        for (int i = 0; i < 5; i++)
        {
            if (result[i] == 'G') continue;
            bool found = false;
            for (int j = 0; j < 5; j++)
            {
                if (!used[j] && guess[i] == target[j])
                {
                    result[i] = 'Y';
                    used[j]   = true;
                    found     = true;
                    break;
                }
            }
            if (!found) result[i] = 'X';
        }

        return result;
    }

    private static readonly string[] FallbackWords =
    {
        "ABOUT","ABOVE","ABUSE","ACTOR","ACUTE","ADMIT","ADOPT","ADULT","AFTER","AGAIN",
        "AGENT","AGREE","AHEAD","ALARM","ALBUM","ALERT","ALIKE","ALIVE","ALLOW","ALONE",
        "ALONG","ALTER","ANGEL","ANGER","ANGLE","ANGRY","ANKLE","APPLE","APPLY","ARISE",
        "ARMOR","AROMA","ARROW","ATTIC","AVOID","BADLY","BAKER","BASIC","BATCH","BEACH",
        "BEARD","BEAST","BELOW","BENCH","BERRY","BIRTH","BLACK","BLADE","BLAME","BLANK",
        "BLAST","BLAZE","BLEND","BLESS","BLIND","BLOCK","BLOOD","BLOOM","BOARD","BOUND",
        "BRAIN","BRAND","BRAVE","BREAD","BREAK","BREED","BRICK","BRIDE","BRIEF","BRING",
        "BROKE","BROOK","BROWN","BRUSH","BUILD","BUILT","BUNCH","BURST","BUYER","CABIN",
        "CABLE","CANDY","CARRY","CATCH","CAUSE","CHAIN","CHAIR","CHAOS","CHARM","CHART",
        "CHASE","CHEAP","CHECK","CHESS","CHEST","CHIEF","CHILD","CHUNK","CIVIC","CIVIL",
        "CLAIM","CLEAN","CLEAR","CLERK","CLICK","CLIFF","CLIMB","CLING","CLOCK","CLONE",
        "CLOSE","CLOTH","CLOUD","CLOWN","COACH","COAST","COUNT","COURT","COVER","CRAFT",
        "CRANE","CRASH","CREAM","CREEK","CRIME","CRISP","CROSS","CROWD","CROWN","CRUEL",
        "CRUSH","CURVE","CYCLE","DAILY","DANCE","DEATH","DECAY","DELAY","DEPTH","DIGIT",
        "DIRTY","DODGE","DOUBT","DOUGH","DRAFT","DRAIN","DRAMA","DREAM","DRESS","DRIFT",
        "DRINK","DRIVE","DROWN","DRUNK","DWARF","DYING","EAGLE","EARLY","EARTH","EIGHT",
        "ELDER","ELECT","EMPTY","ENEMY","ENJOY","ENTER","EQUAL","ERROR","ESSAY","EVENT",
        "EVERY","EXACT","EXIST","EXTRA","FAITH","FALSE","FANCY","FAULT","FEAST","FENCE",
        "FEVER","FIELD","FIFTH","FIFTY","FIGHT","FINAL","FIRST","FIXED","FLAME","FLASH",
        "FLOCK","FLOOD","FLOOR","FLUID","FOCUS","FORCE","FORGE","FORUM","FOUND","FRAME",
        "FRAUD","FRESH","FRONT","FROST","FRUIT","FULLY","FUNNY","GHOST","GIANT","GIVEN",
        "GLASS","GLOBE","GLOOM","GLORY","GLOVE","GRACE","GRADE","GRAND","GRANT","GRASP",
        "GRAVE","GREAT","GREEN","GREET","GRILL","GRIND","GROAN","GROUP","GROVE","GROWL",
        "GROWN","GUARD","GUESS","GUEST","GUIDE","GUILD","HANDS","HAPPY","HARSH","HATCH",
        "HAUNT","HAVEN","HEART","HEAVY","HEDGE","HEIST","HONOR","HORSE","HOTEL","HOVER",
        "HUMAN","HURRY","IMAGE","IMPLY","INDEX","INNER","ISSUE","IVORY","JUDGE","JUICE",
        "JUICY","JUMBO","KNIFE","KNOCK","LABEL","LARGE","LASER","LATER","LAUGH","LAYER",
        "LEARN","LEASE","LEAST","LEAVE","LEGAL","LEVEL","LIMIT","LODGE","LOGIC","LOOSE",
        "LOWER","LUCKY","LUNAR","LYRIC","MAGIC","MAJOR","MAKER","MARCH","MATCH","MONEY",
        "MORAL","MOUNT","MOUTH","MUSIC","OFTEN","ORDER","OTHER","OUTER","OWNER","OXIDE",
        "OZONE","PAINT","PANIC","PAPER","PARTY","PASTA","PEACE","PEARL","PENNY","PHASE",
        "PHONE","PHOTO","PIANO","PIECE","PILOT","PITCH","PIXEL","PIZZA","PLACE","PLAIN",
        "PLANE","PLANT","PLATE","POLAR","POWER","PRESS","PRICE","PRIDE","PRIME","PRINT",
        "PROOF","PROSE","PROUD","PROVE","PULSE","QUEEN","QUEST","QUICK","QUIET","QUOTA",
        "QUOTE","RADAR","RADIO","RAISE","RALLY","RANCH","RANGE","RAPID","RATIO","REACH",
        "READY","REALM","REBEL","REIGN","RELAY","REPAY","REPLY","RESET","RIDER","RIFLE",
        "RIGHT","RISKY","RIVAL","RIVER","ROBOT","ROCKY","ROUGH","ROUND","ROYAL","RULER",
        "RURAL","SALES","SAUCE","SCALE","SCENE","SCORE","SCOUT","SHAPE","SHARE","SHARK",
        "SHARP","SHELF","SHELL","SHIFT","SHINE","SHOCK","SHOOT","SHORT","SHOUT","SIGHT",
        "SILLY","SINCE","SIXTH","SIXTY","SKILL","SKULL","SLATE","SMALL","SMART","SMILE",
        "SMOKE","SOLAR","SOLID","SOLVE","SORRY","SOUND","SOUTH","SPACE","SPARE","SPARK",
        "SPAWN","SPEAK","SPEAR","SPEND","SPICE","SPIKE","SPLIT","SPOKE","SPORT","SPRAY",
        "SQUAD","STACK","STAGE","STAIN","STAIR","STAKE","STALE","STAMP","STAND","STARE",
        "START","STATE","STEAL","STEAM","STEEL","STEEP","STEER","STERN","STONE","STORE",
        "STORM","STORY","STOVE","STRAW","STRAY","STRIP","STUCK","STUDY","STUFF","STYLE",
        "SUGAR","SUITE","SUPER","SURGE","SWAMP","SWIFT","SWING","SWORD","TABLE","TASTE",
        "TEACH","TEETH","TENOR","TENSE","THANK","THEME","THICK","THINK","THORN","THOSE",
        "THREE","THREW","THROW","TIGER","TIGHT","TIMER","TITLE","TOAST","TODAY","TOKEN",
        "TOUCH","TOWER","TOXIC","TRACE","TRACK","TRADE","TRAIL","TRAIN","TRAIT","TRASH",
        "TRIAL","TRIBE","TRICK","TRIED","TROOP","TROUT","TRUCK","TRULY","TRUNK","TRUTH",
        "TUMOR","ULTRA","UNCLE","UNDER","UNION","UNTIL","UPPER","UPSET","URBAN","USUAL",
        "VALID","VALUE","VERSE","VIDEO","VINYL","VIRAL","VIRUS","VISIT","VITAL","VOCAL",
        "VOICE","VOTER","WATCH","WATER","WEARY","WHEAT","WHERE","WHICH","WHILE","WHITE",
        "WHOLE","WHOSE","WITCH","WOMAN","WOMEN","WORLD","WORRY","WORSE","WORST","WORTH",
        "WOULD","WOUND","WRATH","WRIST","YACHT","YEARN","YIELD","YOUNG","YOURS","YOUTH",
        "ZEBRA","PLUME","RAIDS","TOUCH","MATCH","BRAVE","GRACE","FLAME","CRANE","BLAZE"
    };
}

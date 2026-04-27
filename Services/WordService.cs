using System.Collections.Concurrent;
using System.Text;
using System.Text.Json;

namespace WordleBattle.Services;

public class WordService
{
    private readonly IConfiguration _configuration;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly HashSet<string> _usedWords = new();

    // shared validation cache — avoids hitting the dictionary API more than once per word
    private static readonly ConcurrentDictionary<string, bool> _validationCache =
        new(StringComparer.OrdinalIgnoreCase);

    // built-in word list used for both random word selection and fast validation
    private static readonly HashSet<string> WordList = new(StringComparer.OrdinalIgnoreCase)
    {
        "ABOUT","ABOVE","ABUSE","ACTOR","ACUTE","ADMIT","ADOPT","ADULT","AFTER","AGAIN",
        "AGENT","AGREE","AHEAD","ALARM","ALBUM","ALERT","ALIKE","ALIVE","ALLEY","ALLOW",
        "ALONE","ALONG","ALTER","AMBER","ANGEL","ANGER","ANGLE","ANGRY","ANKLE","APART",
        "APPLE","APPLY","ARISE","ARMOR","AROMA","ARROW","ATTIC","AVOID","BADLY","BAKER",
        "BASIC","BATCH","BEACH","BEARD","BEAST","BELOW","BENCH","BERRY","BIRTH","BISON",
        "BLACK","BLADE","BLAME","BLANK","BLAST","BLAZE","BLEED","BLEND","BLESS","BLIND",
        "BLOCK","BLOOD","BLOOM","BOARD","BONUS","BOOTH","BOUND","BRAIN","BRAND","BRAVE",
        "BREAD","BREAK","BREED","BRICK","BRIDE","BRIEF","BRING","BROKE","BROOK","BROWN",
        "BRUSH","BUILD","BUILT","BUNCH","BURST","BUYER","CABIN","CABLE","CAMEL","CANDY",
        "CARRY","CATCH","CAUSE","CHAIN","CHAIR","CHALK","CHAOS","CHARM","CHART","CHASE",
        "CHEAP","CHECK","CHEEK","CHESS","CHEST","CHIEF","CHILD","CHUNK","CIVIC","CIVIL",
        "CLAIM","CLEAN","CLEAR","CLERK","CLICK","CLIFF","CLIMB","CLING","CLOCK","CLONE",
        "CLOSE","CLOTH","CLOUD","CLOWN","COACH","COAST","COBRA","COMET","COMIC","CORAL",
        "COUNT","COURT","COVER","CRAFT","CRANE","CRASH","CREAM","CREEK","CRIME","CRISP",
        "CROSS","CROWD","CROWN","CRUEL","CRUSH","CURVE","CYCLE","DAILY","DANCE","DEATH",
        "DECAY","DELAY","DEMON","DEPTH","DIGIT","DIRTY","DODGE","DOUBT","DOUGH","DRAFT",
        "DRAIN","DRAMA","DREAM","DRESS","DRIFT","DRINK","DRIVE","DROWN","DRUNK","DWARF",
        "DYING","EAGLE","EARLY","EARTH","EIGHT","ELDER","ELECT","EMPTY","ENEMY","ENJOY",
        "ENTER","EQUAL","ERROR","ESSAY","EVENT","EVERY","EXACT","EXIST","EXTRA","FAITH",
        "FALSE","FANCY","FAULT","FEAST","FENCE","FEVER","FIELD","FIFTH","FIFTY","FIGHT",
        "FINAL","FIRST","FIXED","FLAME","FLASH","FLOCK","FLOOD","FLOOR","FLUID","FOCUS",
        "FORCE","FORGE","FORUM","FOUND","FRAME","FRAUD","FRESH","FRONT","FROST","FRUIT",
        "FULLY","FUNNY","GHOST","GIANT","GIVEN","GLASS","GLEAM","GLOBE","GLOOM","GLORY",
        "GLOVE","GRACE","GRADE","GRAND","GRANT","GRASP","GRAVE","GREAT","GREEN","GREET",
        "GRILL","GRIND","GROAN","GROUP","GROVE","GROWL","GROWN","GUARD","GUESS","GUEST",
        "GUIDE","GUILD","HANDS","HAPPY","HARSH","HATCH","HAUNT","HAVEN","HEART","HEAVY",
        "HEDGE","HEIST","HONOR","HORSE","HOTEL","HOVER","HUMAN","HURRY","IMAGE","IMPLY",
        "INDEX","INNER","ISSUE","IVORY","JUDGE","JUICE","JUICY","JUMBO","KNIFE","KNOCK",
        "LABEL","LARGE","LASER","LATER","LAUGH","LAYER","LEARN","LEASE","LEAST","LEAVE",
        "LEGAL","LEVEL","LIMIT","LODGE","LOGIC","LOOSE","LOWER","LUCKY","LUNAR","LYRIC",
        "MAGIC","MAJOR","MAKER","MARCH","MATCH","MOIST","MONEY","MORAL","MOUNT","MOUTH",
        "MUSIC","OFTEN","ORDER","OTHER","OUTER","OWNER","OXIDE","OZONE","PAINT","PANIC",
        "PAPER","PARTY","PASTA","PATCH","PEACE","PEARL","PEDAL","PENNY","PHASE","PHONE",
        "PHOTO","PIANO","PIECE","PILOT","PITCH","PIXEL","PIZZA","PLACE","PLAIN","PLANE",
        "PLANT","PLATE","PLAZA","PLEAD","POLAR","POWER","PRESS","PRICE","PRIDE","PRIME",
        "PRINT","PRIOR","PROBE","PRONE","PROOF","PROSE","PROUD","PROVE","PULSE","QUEEN",
        "QUERY","QUEST","QUEUE","QUICK","QUIET","QUOTA","QUOTE","RADAR","RADIO","RAISE",
        "RALLY","RANCH","RANGE","RAPID","RATIO","REACH","READY","REALM","REBEL","REIGN",
        "RELAY","REPAY","REPLY","RESET","RIDER","RIFLE","RIGHT","RISKY","RIVAL","RIVER",
        "ROBOT","ROCKY","ROUGH","ROUND","ROYAL","RULER","RURAL","SALES","SAUCE","SCALE",
        "SCENE","SCORE","SCOUT","SHAPE","SHARE","SHARK","SHARP","SHELF","SHELL","SHIFT",
        "SHINE","SHOCK","SHOOT","SHORT","SHOUT","SIGHT","SILLY","SINCE","SIXTH","SIXTY",
        "SKILL","SKULL","SLATE","SMALL","SMART","SMILE","SMOKE","SOLAR","SOLID","SOLVE",
        "SORRY","SOUND","SOUTH","SPACE","SPARE","SPARK","SPAWN","SPEAK","SPEAR","SPEND",
        "SPICE","SPIKE","SPLIT","SPOKE","SPORT","SPRAY","SQUAD","STACK","STAGE","STAIN",
        "STAIR","STAKE","STALE","STAMP","STAND","STARE","START","STATE","STEAL","STEAM",
        "STEEL","STEEP","STEER","STERN","STONE","STORE","STORM","STORY","STOVE","STRAW",
        "STRAY","STRIP","STUCK","STUDY","STUFF","STYLE","SUGAR","SUITE","SUPER","SURGE",
        "SWAMP","SWIFT","SWING","SWORD","TABLE","TASTE","TEACH","TEETH","TENOR","TENSE",
        "THANK","THEME","THICK","THINK","THORN","THOSE","THREE","THREW","THROW","TIGER",
        "TIGHT","TIMER","TITLE","TOAST","TODAY","TOKEN","TOWER","TOXIC","TRACE","TRACK",
        "TRADE","TRAIL","TRAIN","TRAIT","TRASH","TRIAL","TRIBE","TRICK","TRIED","TROOP",
        "TROUT","TRUCK","TRULY","TRUNK","TRUTH","TUMOR","ULTRA","UNCLE","UNDER","UNION",
        "UNITY","UNTIL","UPPER","UPSET","URBAN","USUAL","VALID","VALUE","VERSE","VIDEO",
        "VIGOR","VINYL","VIRAL","VIRUS","VISIT","VITAL","VOCAL","VOICE","VOTER","WATCH",
        "WATER","WEARY","WEIRD","WHEAT","WHERE","WHICH","WHILE","WHITE","WHOLE","WHOSE",
        "WITCH","WOMAN","WOMEN","WORLD","WORRY","WORSE","WORST","WORTH","WOULD","WOUND",
        "WRATH","WRIST","YACHT","YEARN","YIELD","YOUNG","YOURS","YOUTH","ZEBRA","ADORN",
        "AGILE","AGLOW","AZURE","BANJO","BLUNT","BRISK","CARAT","CHASM","CLASP","CRIMP",
        "DENIM","DEPOT","EASEL","ECLAT","ELFIN","EMBER","EPOCH","EQUIP","ERODE","ETHIC",
        "EVOKE","EXERT","EXILE","EXPEL","EXTOL","EXULT","FAINT","FLANK","FLARE","FLINT",
        "FLIRT","FOIST","FRAIL","FREAK","FROTH","FUDGE","GAMUT","GAUDY","GAUNT","GAVEL",
        "GLEAM","GLEAN","GLOAT","GOLLY","GOUGE","GRAIL","GRIME","GRIPE","GRUFF","GUSTO",
        "GYPSY","HASTY","HEADY","HIPPO","HOMER","HORDE","HORNY","HOUND","INEPT","INFER",
        "INFIX","INGOT","INSET","INTER","INTRO","IONIC","IRONY","JAUNT","JAZZY","JELLY",
        "JERKY","JOIST","JOUST","KINKY","KNACK","KNAVE","KNEAD","KNELT","KNOLL","KNOWN",
        "LANKY","LAPEL","LAPSE","LATCH","LATHE","LAXLY","LEECH","LEMUR","LOFTY","LORRY",
        "LOUSY","LOWLY","LUSTY","LUSUS","MAXIM","MEALY","MELEE","MERCY","MERGE","MERIT",
        "MESSY","MIDST","MIGHT","MILKY","MIMIC","MIRTH","MOLAR","MOLDY","MOODY","MOSSY",
        "MOTTO","MUDDY","MUGGY","MULCH","MURKY","MUSTY","NAIVE","NASTY","NATTY","NAVAL",
        "NIFTY","NIGHT","NIPPY","NITTY","NOBLY","NOTCH","NOVEL","NUDGE","NUTTY","NYMPH",
        "OAKUM","OCCUR","ONION","OPTIC","ORBIT","ORCHID","OUTDO","OVARY","OVOID","OXIDE",
        "PADDY","PAGAN","PAPAL","PATCH","PATSY","PAVID","PERKY","PESKY","PETTY","PETTY",
        "PHONY","PILOT","PINCH","PINEY","PITHY","PLUCK","PLUMB","PLUME","PLUMP","PLUNK",
        "POACH","POUTY","PRAWN","PRIVY","PRUDE","PRIVY","PUNCH","PUPIL","PUTTY","PYGMY",
        "QUALM","QUASH","QUAFF","QUALM","QUELL","QUILT","QUIRK","QUOTH","RASPY","RATTY",
        "RAVEN","RAYON","REGAL","REVEL","RIGID","RIVET","ROBIN","RODEO","ROGUE","ROOMY",
        "ROTUND","RUDDY","RUGBY","RULED","RUMBA","RUSTY","SADLY","SALTY","SANDY","SAPID",
        "SASSY","SAUCY","SAVVY","SCALP","SCAMP","SCANT","SCOFF","SCOLD","SCOOP","SCOPE",
        "SCORN","SCOWL","SCRAM","SCRUB","SCUFF","SEEDY","SEIZE","SERUM","SETUP","SHADY",
        "SHALE","SHANK","SHEAF","SHEAR","SHEEN","SHEER","SHIRE","SHIRK","SHRUB","SHUCK",
        "SHUNT","SIEGE","SKIMP","SKIMP","SLAIN","SLAKE","SLANG","SLANT","SLASH","SLEEK",
        "SLEET","SLICK","SLIER","SLIME","SLIMY","SLING","SLINK","SLOSH","SLOTH","SLUMP",
        "SLUNG","SLUNK","SLYLY","SMACK","SMEAR","SMELT","SMIRK","SNACK","SNARE","SNARL",
        "SNEAK","SNEER","SNIDE","SNIFF","SNORE","SNORT","SNOUT","SNUCK","SOBER","SOGGY",
        "STOMP","STOIC","STOMP","STONY","STOMP","STRAP","STRUM","STRUT","STUNG","STUNK",
        "STUNT","SUAVE","SULKY","SULLEN","SULTAN","SULLY","SUNNY","SURLY","SWEAR","SWEAT",
        "SWEET","SWEPT","SWILL","SWINE","SWIPE","SWIRL","TACIT","TAFFY","TALLY","TALON",
        "TANGY","TAUNT","TAWNY","TEETH","TEPID","TERSE","TESTY","THANE","THIEF","TIDAL",
        "TIMID","TIPSY","TITAN","TIZZY","TOADY","TOPAZ","TOPSY","TORSO","TOUCHY","TOXIC",
        "TRAMP","TRUCE","TRUMP","TRYST","TUBBY","TULIP","TUMMY","TUNER","TUSKS","TWANG",
        "TWEAK","TWEED","TWEET","TWIRL","TWITCH","ULCER","UDDER","VAPOR","VAUNT","VENOM",
        "VICAR","VIGIL","VIOLA","VIPER","VOGUE","VOUCH","WACKY","WADDLE","WAGER","WALTZ",
        "WARTY","WEEDY","WIMPY","WITTY","WORDY","ZAPPY","ZINGY","ZIPPY","ZONAL","MUSTY"
    };

    private static readonly string[] WordArray = WordList.Where(w => w.Length == 5).ToArray();

    public WordService(IConfiguration configuration, IHttpClientFactory httpClientFactory)
    {
        _configuration = configuration;
        _httpClientFactory = httpClientFactory;
    }

    public async Task<string> GetRandomWordAsync()
    {
        var apiKey = _configuration["ClaudeApiKey"];
        if (!string.IsNullOrEmpty(apiKey))
        {
            var claudeWord = await TryGetWordFromClaude(apiKey);
            if (claudeWord != null)
            {
                _usedWords.Add(claudeWord);
                return claudeWord;
            }
        }

        return GetRandomWordFromList();
    }

    private string GetRandomWordFromList()
    {
        var available = WordArray.Where(w => !_usedWords.Contains(w)).ToArray();
        if (available.Length == 0)
        {
            _usedWords.Clear();
            available = WordArray;
        }
        var word = available[Random.Shared.Next(available.Length)];
        _usedWords.Add(word);
        return word;
    }

    private async Task<string?> TryGetWordFromClaude(string apiKey)
    {
        try
        {
            var prompt = "Generate a random valid 5-letter English word. Only respond with the word in UPPERCASE, nothing else. The word must be a common English word.";
            var request = new
            {
                model = "claude-haiku-4-5-20251001",
                max_tokens = 10,
                messages = new[] { new { role = "user", content = prompt } }
            };

            var json = JsonSerializer.Serialize(request);
            var httpContent = new StringContent(json, Encoding.UTF8, "application/json");

            using var httpRequest = new HttpRequestMessage(HttpMethod.Post, "https://api.anthropic.com/v1/messages");
            httpRequest.Headers.Add("x-api-key", apiKey);
            httpRequest.Headers.Add("anthropic-version", "2023-06-01");
            httpRequest.Content = httpContent;

            var client = _httpClientFactory.CreateClient();
            using var response = await client.SendAsync(httpRequest);
            if (!response.IsSuccessStatusCode) return null;

            var responseText = await response.Content.ReadAsStringAsync();
            var jsonDoc = JsonDocument.Parse(responseText);
            var word = jsonDoc.RootElement
                .GetProperty("content")[0]
                .GetProperty("text")
                .GetString()?
                .Trim()
                .ToUpper() ?? "";

            if (word.Length == 5 && word.All(c => c >= 'A' && c <= 'Z'))
                return word;

            return null;
        }
        catch
        {
            return null;
        }
    }

    // Checks the built-in list first, then falls back to the free dictionary API.
    // API results are cached so each word only hits the network once.
    public async Task<bool> IsValidWordAsync(string word)
    {
        word = word.ToUpper().Trim();
        if (word.Length != 5 || !word.All(c => c >= 'A' && c <= 'Z')) return false;

        if (WordList.Contains(word)) return true;
        if (_validationCache.TryGetValue(word, out var cached)) return cached;

        var valid = await CheckDictionaryApiAsync(word.ToLower());
        _validationCache[word] = valid;
        return valid;
    }

    private async Task<bool> CheckDictionaryApiAsync(string word)
    {
        try
        {
            var client = _httpClientFactory.CreateClient();
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(4));
            var response = await client.GetAsync(
                $"https://api.dictionaryapi.dev/api/v2/entries/en/{word}",
                cts.Token);
            return response.IsSuccessStatusCode;
        }
        catch
        {
            return true; // fail open if API is unreachable
        }
    }

    // Returns a char array: G = correct position, Y = wrong position, X = not in word
    public char[] CheckGuess(string guess, string target)
    {
        guess = guess.ToUpper();
        target = target.ToUpper();

        var result = new char[5];
        var used = new bool[5];

        for (int i = 0; i < 5; i++)
        {
            if (guess[i] == target[i])
            {
                result[i] = 'G';
                used[i] = true;
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
                    used[j] = true;
                    found = true;
                    break;
                }
            }

            if (!found) result[i] = 'X';
        }

        return result;
    }
}

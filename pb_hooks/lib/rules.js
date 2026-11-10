// Auto-categorization, in order of trust:
//   1. the user's own rules ("contains X → category")
//   2. what the user has taught Keel: merchants they've categorized by hand before
//   3. the built-in merchant directory below
// Bank descriptions are messy ("PURCHASE AUTHORIZED ON 11/02 SQ *BLUE BOTTLE #123"), so text is
// cleaned first and keywords match whole words only ("rent" no longer matches "current").

// Each entry: [category, strong merchant names, weak generic words].
// Strong names always beat weak words; within a tier the longest match wins
// ("uber eats" beats "uber", "costco gas" beats "costco").
const DIRECTORY = [
  ["Paycheck", [
    "payroll", "direct dep", "dir dep", "directdep", "direct deposit payroll", "salary", "paycheck", "adp", "gusto", "paychex",
    "trinet", "justworks", "rippling", "intuit payroll", "quickbooks payroll", "paylocity", "paycom", "ceridian", "workday",
  ], ["pay day", "payday", "wages", "net pay"]],
  ["Other Income", [
    "interest paid", "interest earned", "int earned", "interest payment", "dividend", "div paid", "irs treas", "tax ref", "tax refund",
    "ssa treas", "social security", "unemployment", "cash back reward", "cashback reward", "rewards redemption", "statement credit",
  ], ["deposit", "mobile deposit", "atm deposit", "refund", "rebate", "reimbursement", "interest"]],
  ["Credit Card Payment", [
    "payment thank you", "pymt thank you", "credit card payment", "credit crd", "crd epay", "card services", "cardmember serv",
    "american express", "amex epayment", "amex", "chase card", "chase credit", "citi card", "citicard", "capital one mobile pmt",
    "capital one online pmt", "capital one crcardpmt", "discover card", "discover e-payment", "discover epayment", "applecard",
    "apple card", "synchrony", "barclaycard", "bk of amer visa", "bank of america credit card", "wells fargo card", "usaa credit card",
    "credit one", "merrick bank", "mission lane", "bilt mastercard",
  ], ["autopay", "auto pay", "epay", "e-payment", "epayment", "card payment", "online payment", "mobile payment"]],
  ["Transfers", [
    "zelle", "venmo", "cash app", "square cash", "paypal transfer", "apple cash", "online banking transfer", "internal transfer",
    "transfer to", "transfer from", "to savings", "from savings", "to checking", "from checking", "wire transfer", "remitly",
    "western union", "moneygram", "wise", "xoom",
  ], ["transfer", "xfer", "trnsfr"]],
  ["Investing", [
    "vanguard", "fidelity", "schwab", "robinhood", "betterment", "wealthfront", "coinbase", "acorns", "stash invest", "e trade",
    "etrade", "m1 finance", "webull", "public com", "merrill", "td ameritrade", "ally invest", "sofi invest", "edward jones",
    "crypto com", "kraken", "gemini", "binance", "fundrise", "treasurydirect",
  ], ["brokerage", "invest", "ira contribution"]],
  ["Rent / Mortgage", [
    "rocket mortgage", "quicken loans", "home mtg", "mr cooper", "pennymac", "freedom mortgage", "loancare", "newrez",
    "shellpoint", "appfolio", "buildium", "rentcafe", "yardi", "bilt rent", "avail rent", "zillow rent", "rent payment",
    "property management", "mtg pymt", "mortgage payment",
  ], ["rent", "mortgage", "landlord", "apartment", "apartments", "lease", "properties", "realty", "management", "mgmt", "property mgmt", "residential"]],
  ["Utilities", [
    "comcast", "xfinity", "spectrum", "charter comm", "cox comm", "verizon", "vzwrls", "at&t", "att", "t-mobile", "tmobile",
    "sprint", "mint mobile", "visible", "cricket wireless", "boost mobile", "metropcs", "metro by t-mobile", "us cellular",
    "google fi", "frontier comm", "centurylink", "lumen", "optimum", "altice", "suddenlink", "mediacom", "windstream",
    "starlink", "hughesnet", "duke energy", "dominion energy", "pg&e", "pge", "southern california edison", "con ed", "coned",
    "national grid", "xcel energy", "entergy", "fpl", "georgia power", "ameren", "consumers energy", "dte energy", "eversource",
    "pseg", "oncor", "txu energy", "reliant energy", "direct energy", "atmos energy", "nicor", "piedmont natural", "spire",
    "peoples gas", "cps energy", "ladwp", "waste management", "republic services", "aps", "srp", "puget sound energy", "pepco",
    "bge", "comed", "peco", "ppl electric", "first energy", "firstenergy", "aep", "appalachian power", "alabama power",
  ], ["electric", "energy", "power", "water", "utility", "utilities", "gas co", "natural gas", "sewer", "trash", "internet",
    "broadband", "wireless", "cable", "phone bill"]],
  ["Groceries", [
    "kroger", "safeway", "whole foods", "wholefds", "trader joe", "trader joes", "aldi", "publix", "heb", "h-e-b", "wegmans",
    "food lion", "giant eagle", "giant food", "stop & shop", "stop and shop", "shoprite", "harris teeter", "meijer", "hy-vee",
    "hyvee", "winco", "winn-dixie", "winn dixie", "sprouts", "fresh market", "albertsons", "vons", "ralphs", "fred meyer",
    "food 4 less", "foodmaxx", "smart & final", "piggly wiggly", "ingles", "lidl", "save a lot", "grocery outlet",
    "market basket", "hannaford", "shaws", "jewel osco", "jewel-osco", "acme markets", "tops markets", "price chopper",
    "schnucks", "dierbergs", "frys food", "king soopers", "smiths food", "raleys", "stater bros", "food city", "weis markets",
    "pick n save", "cub foods", "instacart", "freshdirect", "thrive market", "misfits market", "imperfect foods", "costco",
    "sams club", "sam s club", "bjs wholesale", "walmart grocery", "amazon fresh", "99 ranch market", "h mart", "natural grocers",
    "fareway", "festival foods", "lowes foods", "save mart", "baker s", "dillons", "marianos", "food bazaar", "key food",
  ], ["grocery", "groceries", "supermarket", "market", "foods"]],
  ["Dining Out", [
    "starbucks", "dunkin", "doordash", "grubhub", "uber eats", "ubereats", "postmates", "seamless", "caviar", "mcdonalds",
    "burger king", "wendys", "taco bell", "chick-fil-a", "chickfila", "chick fil a", "chipotle", "subway", "panera",
    "panda express", "dominos", "pizza hut", "papa johns", "little caesars", "kfc", "popeyes", "sonic drive", "arbys",
    "jack in the box", "five guys", "shake shack", "in-n-out", "in n out", "whataburger", "culvers", "dairy queen",
    "jimmy johns", "jersey mikes", "firehouse subs", "qdoba", "moes", "wingstop", "buffalo wild wings", "olive garden",
    "applebees", "chilis", "ihop", "dennys", "waffle house", "cracker barrel", "red robin", "outback", "texas roadhouse",
    "cheesecake factory", "red lobster", "longhorn", "pf chang", "p f chang", "noodles & co", "sweetgreen", "cava",
    "raising canes", "zaxbys", "bojangles", "white castle", "del taco", "el pollo loco", "steak n shake", "tim hortons",
    "peets", "dutch bros", "caribou coffee", "krispy kreme", "baskin", "cold stone", "insomnia cookies", "crumbl", "jamba",
    "smoothie king", "tropical smoothie", "cinnabon", "auntie anne", "potbelly", "portillos", "bjs restaurant", "hooters",
    "carrabbas", "maggianos", "pei wei", "torchys", "first watch", "cookout", "cook out", "freddys", "mod pizza",
    "blaze pizza", "chuck e cheese", "toast", "tst",
  ], ["restaurant", "restaurants", "cafe", "coffee", "espresso", "pizza", "pizzeria", "taco", "tacos", "taqueria", "grill",
    "bistro", "diner", "kitchen", "eatery", "bbq", "barbecue", "sushi", "ramen", "pho", "burger", "burgers", "bakery",
    "brewing", "brewery", "tavern", "pub", "cantina", "deli", "wings", "steakhouse", "noodle", "bagel", "donut", "donuts",
    "creamery", "ice cream", "boba", "tea house", "winery", "wine bar", "bar & grill", "food truck", "catering"]],
  ["Transportation", [
    "shell", "chevron", "exxon", "exxonmobil", "mobil", "bp", "sunoco", "marathon petro", "speedway", "valero", "citgo",
    "phillips 66", "conoco", "arco", "circle k", "sheetz", "quiktrip", "racetrac", "caseys", "kwik trip", "kwik star",
    "loves travel", "pilot travel", "flying j", "costco gas", "sams fuel", "kum & go", "holiday stationstores", "murphy usa",
    "bucees", "buc-ee", "uber", "lyft", "parkmobile", "spothero", "paybyphone", "ez pass", "e-zpass", "ezpass", "sunpass",
    "fastrak", "txtag", "peach pass", "ipass", "amtrak", "greyhound", "jiffy lube", "valvoline", "autozone", "oreilly auto",
    "advance auto", "napa auto", "pep boys", "firestone", "goodyear", "discount tire", "midas", "meineke", "take 5 oil",
    "tesla supercharger", "chargepoint", "electrify america", "evgo", "zipcar", "turo", "toyota financial", "honda financial",
    "ford credit", "gm financial", "ally auto", "carmax auto", "santander consumer", "capital one auto", "wmata", "septa",
    "mbta", "bart", "clipper", "ventra", "metrocard", "omny", "mta",
  ], ["gas station", "fuel", "gasoline", "parking", "toll", "tolls", "transit", "taxi", "cab", "car wash", "dmv", "auto repair",
    "tire", "tires", "oil change", "smog", "registration", "auto loan", "car payment"]],
  ["Travel", [
    "delta air", "united airlines", "american airlines", "american air", "southwest air", "southwes", "jetblue", "alaska air",
    "spirit airl", "frontier airl", "allegiant", "hawaiian air", "sun country", "air canada", "british airways", "lufthansa",
    "expedia", "booking com", "hotels com", "priceline", "kayak", "airbnb", "vrbo", "marriott", "hilton", "hyatt", "ihg",
    "holiday inn", "hampton inn", "best western", "wyndham", "la quinta", "motel 6", "sheraton", "westin", "hertz", "avis",
    "enterprise rent", "national car", "alamo", "budget rent", "sixt", "thrifty", "dollar rent", "global entry",
    "tsa precheck", "carnival cruise", "royal caribbean", "norwegian cruise", "hopper",
  ], ["airline", "airlines", "airways", "hotel", "motel", "resort", "cruise", "travel"]],
  ["Insurance", [
    "geico", "state farm", "progressive", "allstate", "liberty mutual", "farmers ins", "nationwide", "usaa p&c",
    "travelers ins", "the hartford", "lemonade", "root insurance", "metlife", "prudential", "aflac", "mutual of omaha",
    "northwestern mutual", "new york life", "erie ins", "american family", "amfam", "amica", "esurance", "kemper", "mercury ins",
    "safeco", "hippo", "policygenius", "haven life", "bestow",
  ], ["insurance", "insur", "ins prem", "premium"]],
  ["Health", [
    "cvs", "walgreens", "rite aid", "duane reade", "labcorp", "quest diagnostics", "lenscrafters", "warby parker", "kaiser",
    "betterhelp", "talkspace", "hims", "goodrx", "zocdoc", "one medical", "minuteclinic", "teladoc", "planet fitness",
    "la fitness", "24 hour fitness", "anytime fitness", "equinox", "orangetheory", "crunch fitness", "golds gym",
    "lifetime fitness", "life time", "ymca", "f45", "peloton", "classpass", "blink fitness", "snap fitness", "barrys",
  ], ["pharmacy", "rx", "doctor", "medical", "dental", "dentist", "orthodont", "orthodontics", "clinic", "hospital",
    "urgent care", "optometry", "optometrist", "vision", "eyecare", "physician", "pediatric", "pediatrics", "dermatology",
    "chiropractic", "therapy", "therapist", "counseling", "health", "healthcare", "gym", "fitness", "yoga", "pilates",
    "crossfit", "climbing", "bouldering", "climbing gym", "dds", "radiology", "surgery", "copay"]],
  ["Subscriptions", [
    "netflix", "spotify", "hulu", "disney plus", "disneyplus", "youtube premium", "youtube tv", "youtubetv", "google youtube",
    "apple com bill", "itunes", "prime video", "amazon prime", "hbo max", "hbomax", "max com", "paramount", "peacock",
    "crunchyroll", "sling tv", "fubo", "philo", "espn plus", "audible", "kindle unlimited", "patreon", "substack", "medium",
    "nytimes", "new york times", "wsj", "washington post", "the athletic", "apple music", "apple tv", "icloud",
    "google storage", "google one", "dropbox", "microsoft 365", "office 365", "adobe", "canva", "notion", "slack", "zoom us",
    "chatgpt", "openai", "anthropic", "claude ai", "github", "1password", "lastpass", "dashlane", "nordvpn", "expressvpn",
    "surfshark", "grammarly", "duolingo", "headspace", "calm com", "xbox game pass", "xbox live", "playstation plus",
    "nintendo online", "ea play", "siriusxm", "sirius xm", "pandora", "tidal", "deezer", "ring com", "simplisafe", "adt",
    "match com", "tinder", "bumble", "hinge", "linkedin premium", "experian", "credit karma plus", "ancestry", "23andme",
    "hello fresh", "hellofresh", "blue apron", "factor", "home chef", "dollar shave", "ipsy", "birchbox", "fabfitfun",
  ], ["subscription", "monthly plan", "membership fee"]],
  ["Entertainment", [
    "amc", "regal", "cinemark", "fandango", "ticketmaster", "livenation", "live nation", "stubhub", "seatgeek", "eventbrite",
    "steam games", "steampowered", "playstation", "xbox", "nintendo", "epic games", "roblox", "topgolf", "dave & buster",
    "dave and buster", "six flags", "disneyland", "walt disney world", "universal studios", "cedar fair", "main event",
    "round1", "bowlero", "barnes & noble", "barnes and noble", "books a million", "audible", "twitch",
  ], ["movie", "movies", "cinema", "theatre", "theater", "tickets", "concert", "bowling", "golf", "museum", "zoo", "aquarium",
    "arcade", "games", "gaming", "bookstore", "books", "music", "festival", "amusement", "escape room", "karaoke", "bar", "lounge"]],
  ["Personal Care", [
    "great clips", "supercuts", "sport clips", "ulta", "sephora", "bath & body works", "bath and body works",
    "european wax", "drybar", "fantastic sams", "massage envy", "hand & stone",
  ], ["salon", "barber", "barbershop", "hair", "nails", "nail", "spa", "massage", "beauty", "cosmetics", "waxing", "lash",
    "brows", "tanning", "dry clean", "dry cleaning", "cleaners", "laundromat", "laundry", "skincare", "tattoo"]],
  ["Home", [
    "home depot", "lowes", "menards", "ace hardware", "true value", "harbor freight", "ikea", "wayfair", "bed bath",
    "homegoods", "pottery barn", "crate & barrel", "crate and barrel", "williams sonoma", "sherwin williams", "terminix",
    "orkin", "taskrabbit", "angi", "public storage", "extra space", "cubesmart", "life storage", "at home", "kirklands",
    "la z boy", "ashley furniture", "rooms to go", "mattress firm", "purple", "casper", "tempur", "rug doctor",
  ], ["hardware", "lawn", "landscaping", "garden", "nursery", "pest control", "plumbing", "plumber", "electrician", "hvac",
    "roofing", "cleaning service", "maid", "hoa", "homeowners assoc", "storage", "furniture", "mattress", "appliance", "locksmith"]],
  ["Pets", [
    "petco", "petsmart", "chewy", "pet supplies plus", "banfield", "vca animal", "rover", "wag", "barkbox", "bark box",
    "pet supermarket", "petland", "trupanion", "embrace pet",
  ], ["pet", "pets", "veterinary", "vet", "animal hospital", "grooming", "kennel", "dog grooming", "pet food"]],
  ["Shopping", [
    "amazon", "amzn", "amazon mktp", "amzn mktp", "target", "walmart", "wal-mart", "wm supercenter", "best buy", "etsy",
    "ebay", "apple store", "kohls", "macys", "nordstrom", "tj maxx", "tjmaxx", "marshalls", "ross stores", "burlington",
    "old navy", "gap", "banana republic", "h&m", "zara", "uniqlo", "nike", "adidas", "foot locker", "dicks sporting",
    "rei", "academy sports", "bass pro", "cabelas", "shein", "temu", "aliexpress", "overstock", "dollar tree",
    "dollar general", "family dollar", "five below", "big lots", "michaels", "hobby lobby", "joann", "staples",
    "office depot", "gamestop", "newegg", "b&h photo", "container store", "tuesday morning", "jcpenney", "jcp", "belk",
    "dillards", "saks", "neiman marcus", "anthropologie", "urban outfitters", "american eagle", "abercrombie", "hollister",
    "lululemon", "athleta", "victorias secret", "torrid", "lane bryant", "carters", "childrens place", "zappos", "dsw",
    "famous footwear", "skechers", "journeys", "claires", "kay jewelers", "zales", "pandora jewelry", "shopify", "wish",
    "poshmark", "mercari", "depop", "thredup", "rent the runway", "stitch fix", "chewy", "apple com", "microsoft store",
  ], ["store", "shop", "boutique", "outlet", "mall", "retail", "clothing", "apparel", "shoes", "jewelry", "electronics", "merch", "merchandise"]],
  ["Cash & ATM", [
    "atm withdrawal", "atm w d", "atm wd", "atm cash", "cash withdrawal", "withdrawal atm", "teller withdrawal",
    "counter withdrawal", "cash advance",
  ], ["atm", "cash"]],
  ["Fees & Charges", [
    "overdraft", "nsf fee", "insufficient funds", "monthly service fee", "service charge", "maintenance fee", "atm fee",
    "foreign transaction fee", "intl transaction fee", "late fee", "annual fee", "interest charge", "finance charge",
    "wire fee", "returned item", "paper statement fee", "cash advance fee",
  ], ["fee", "fees"]],
  ["Education", [
    "coursera", "udemy", "skillshare", "masterclass", "chegg", "khan academy", "navient", "nelnet", "mohela", "great lakes",
    "sallie mae", "aidvantage", "edfinancial", "fedloan", "studentaid", "pearson", "mcgraw hill",
  ], ["tuition", "university", "college", "school", "academy", "student loan", "textbook", "course"]],
  ["Charity", [
    "red cross", "unicef", "salvation army", "gofundme", "st jude", "united way", "wikimedia", "habitat for humanity",
    "doctors without borders", "aspca", "humane society", "feeding america", "givewell", "kiva",
  ], ["donation", "donate", "charity", "church", "tithe", "ministries", "ministry", "foundation", "nonprofit"]],
  ["Gifts", [
    "hallmark", "1-800-flowers", "1800flowers", "ftd", "edible arrangements", "proflowers", "teleflora", "shari s berries",
  ], ["gift", "gifts", "florist", "flowers"]],
];

// Utah merchants, with extra coverage for Ogden / Weber County, Brigham City / Box Elder and
// Logan / Cache Valley. City names alone are never keywords (bank text often ends with
// "OGDEN UT"), only business names.
const REGIONAL = [
  ["Groceries", [
    "smiths", "smiths marketplace", "harmons", "maceys", "lees marketplace", "lees market", "ridleys", "ridleys family",
    "dicks market", "kents market", "bowmans market", "stokes market", "stokes marketplace", "days market", "rancho market",
    "rancho markets", "la favorita", "associated food", "lins market", "reams", "gossner", "winco foods",
  ], []],
  ["Dining Out", [
    // Utah chains
    "cafe rio", "costa vida", "zupas", "cafe zupas", "swig", "fiiz", "sodalicious", "dirty dough", "chip cookies",
    "crave cookies", "arctic circle", "apollo burger", "crown burgers", "hires big h", "training table", "bajio", "barbacoa",
    "cubbys", "rumbi", "kneaders", "great harvest", "gandolfos", "betos", "red iguana", "j dawgs", "jdawgs", "pizza pie cafe",
    "the pie pizzeria", "litzas pizza", "leatherbys", "wingers", "black bear diner", "village inn", "iceberg drive inn",
    "hruskas kolaches", "waffle love", "sweeto burrito", "mo bettahs", "mo-bettahs", "beans & brews", "beans and brews",
    "pier 49 pizza", "hokulia", "warrens", "warrens craft burgers", "even stevens", "teriyaki stix",
    "sill s cafe", "sills cafe", "pita pit", "neighborhood hangout", "chunga s", "chungas",
    // Ogden / Weber County
    "roosters brewing", "roosters", "lucky slice", "slackwater", "pig & a jelly jar", "pig and a jelly jar", "hearth on 25th",
    "union grill", "tona sushi", "rovalis", "sonora grill", "grounds for coffee", "ramen haus",
    "ogdens own", "the shooting star saloon", "shooting star saloon",
    // Brigham City / Box Elder
    "maddox ranch", "maddox ranch house", "peach city", "peach city ice cream", "idle isle",
    // Logan / Cache Valley
    "aggie ice cream", "angies restaurant", "firehouse pizzeria", "herms inn", "juniper take out", "cafe sabor",
    "center street grill", "bluebird restaurant", "tandoori oven", "mortys cafe", "jacks wood fired", "le nonne",
    "coppermill restaurant", "caspers ice cream", "elements restaurant", "the white owl",
    // seen on real Ogden-area statements
    "snowie", "snowie usa", "zeppes", "zeppes italian ice", "mac attack", "tokyo station", "menchies", "yogurtland",
    "sweet frog", "fiiz drinks", "swig drinks", "bubble tea", "nielsens frozen custard", "leatherbys family creamery",
  ], ["frozen yogurt", "yogurt", "froyo", "shaved ice", "shave ice", "snow cone", "italian ice", "soda", "sodas", "soda shop",
    "drive in", "drive-in", "custard", "creamery", "shakes", "drinks"]],
  ["Transportation", [
    "maverik", "sinclair", "common cents", "top stop", "tesoro", "holiday oil", "quick quack", "tagg n go", "tagg-n-go",
    "big o tires", "les schwab", "burt brothers", "uta", "utah transit", "frontrunner", "udot", "utah dmv",
    "utah motor vehicle", "ken garff", "larry h miller", "lhm", "slc airport parking", "smiths fuel", "maverik fuel",
    "bay wash", "ride pride", "ride pride carwash", "mister car wash", "super suds", "sparkle car wash", "goo goo car wash",
  ], ["carwash", "car wash", "auto wash", "auto spa", "express wash", "detailing", "auto detail"]],
  ["Utilities", [
    "rocky mountain power", "enbridge", "enbridge gas", "questar", "questar gas", "logan city utilities", "logan city light",
    "logan city corp", "ogden city utilities", "ogden city corp", "brigham city corp", "brigham city utilities",
    "weber basin water", "bona vista water", "utopia", "utopia fiber", "xmission", "google fiber", "beehive broadband",
    "allwest", "veracity", "centracom", "sumo fiber", "connext", "ace disposal", "wasatch integrated",
  ], ["city corporation", "city corp", "city utilities", "water district", "improvement district", "sewer district"]],
  ["Health", [
    "intermountain", "intermountain health", "mckay-dee", "mckay dee", "logan regional", "ogden regional", "ogden clinic",
    "tanner clinic", "budge clinic", "revere health", "mountainstar", "university of utah health", "u of u health",
    "instacare", "vasa fitness", "vasa", "momentum climbing", "the front climbing", "the front climb", "the front ogden",
    "the front slc", "the front logan", "cache valley hospital",
    "brigham city community hospital", "primary childrens", "smiths pharmacy",
  ], []],
  ["Insurance", [
    "selecthealth", "select health", "regence", "bear river mutual", "farm bureau", "dmba", "pehp", "emi health",
    "university of utah health plans",
  ], []],
  ["Entertainment", [
    "lagoon", "cherry hill", "boondocks", "megaplex", "snowbasin", "powder mountain", "nordic valley", "beaver mountain",
    "cherry peak", "snowbird", "alta ski", "brighton resort", "solitude mountain", "park city mountain", "deer valley",
    "sundance", "ogden raptors", "utah jazz", "real salt lake", "salt lake bees", "hogle zoo", "living planet aquarium",
    "thanksgiving point", "treehouse museum", "dinosaur park", "fat cats", "classic fun center", "peerys egyptian",
    "ellen eccles", "utah festival opera", "get air", "cowabunga bay", "seven peaks", "ogden nature center",
    "utah state parks", "recreation gov", "epic pass", "ikon pass", "ski utah", "aggie athletics", "weber state athletics",
  ], []],
  ["Shopping", [
    "deseret book", "deseret industries", "deseret ind", "als sporting", "als sporting goods", "sportsmans warehouse",
    "scheels", "cal ranch", "downeast", "down east", "newgate mall", "cache valley mall", "station park", "zurchers",
    "orson gygi", "gygi", "kirkhams", "fred meyer",
  ], []],
  ["Home", ["rc willey", "r c willey", "ifa country store", "ifa"], []],
  ["Education", [
    "weber state", "weber state university", "utah state university", "usu", "bridgerland", "bridgerland technical",
    "ogden-weber tech", "ogden weber tech", "owtc", "davis tech", "university of utah", "byu", "brigham young", "uvu",
    "utah valley university", "slcc", "salt lake community college", "box elder school district",
    "cache county school district", "logan city school district", "ogden school district", "weber school district",
  ], []],
  ["Charity", ["church of jesus christ", "the church of jesus christ", "lds church", "tithing", "fast offering", "utah food bank"], []],
  ["Subscriptions", ["playit", "playit gg", "fishbrain", "onx", "onx maps", "gohunt", "strava", "alltrails", "allstays"], []],
  ["Shopping", ["rainbow gardens"], []],
];

// If a user removed or archived a category, send its merchants somewhere sensible instead.
const FALLBACK = {
  "Travel": "Entertainment", "Home": "Shopping", "Pets": "Shopping", "Charity": "Gifts", "Fees & Charges": "",
  "Education": "", "Investing": "Transfers", "Cash & ATM": "", "Subscriptions": "Entertainment", "Personal Care": "Shopping",
};
const INCOME_ONLY = { "Paycheck": 1, "Other Income": 1 };
const SPEND_ONLY = { "Cash & ATM": 1 };

// "PURCHASE AUTHORIZED ON 11/02 SQ *BLUE BOTTLE #123 SAN FRANCISCO CA" -> "blue bottle san francisco ca"
function clean(s) {
  return " " + String(s || "").toLowerCase()
    .replace(/[’']/g, "")
    .replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, " ")
    .replace(/[.]/g, " ")
    .replace(/[^a-z0-9&\-\s]+/g, " ")
    // drop store numbers and reference codes, keep names like "f45" or "1password"
    .replace(/\b[a-z\d]*\d[a-z\d]*\b/g, (w) => (/^\d+$/.test(w) || (w.match(/\d/g) || []).length >= 3 ? " " : w))
    .replace(/\s+/g, " ").trim() + " ";
}
// "TST* JOES" is a Toast (restaurant) point of sale.
const TOAST = /(^|[^a-z])tst\s?\*/i;

const keyFor = (k) => " " + clean(k).trim() + " ";
const COMPILED = [];
// Generic payment/transfer words lose to any other generic word ("CITY UTILITY ONLINE PAYMENT" is a utility).
const LOW_WEAK = { "Credit Card Payment": 1, "Transfers": 1, "Other Income": 1 };
// Person-to-person payments name a person, which can look like a business ("ZELLE TO MADDOX SMITH").
const P2P = { "zelle": 1, "venmo": 1, "cash app": 1, "square cash": 1, "apple cash": 1, "paypal transfer": 1 };
for (const [cat, strong, weak] of DIRECTORY.concat(REGIONAL)) {
  for (const k of strong) {
    const key = keyFor(k);
    // also catch run-together spellings: "YouTubePremium", "STEAMGAMES.COM", "HOMEDEPOT"
    const glued = key.replace(/[^a-z&]/g, "");
    COMPILED.push({ cat, key, score: (P2P[k] ? 5000 : 1000) + k.length, glued: glued.length >= 7 && key.trim().indexOf(" ") !== -1 ? glued : "" });
  }
  for (const k of weak) COMPILED.push({ cat, key: keyFor(k), score: LOW_WEAK[cat] ? k.length / 100 : k.length });
}

// Best directory match for a transaction: { name, score } or null.
function directoryMatch(rawText, amount) {
  const text = clean(rawText);
  const tokens = text.trim().split(" ").filter((t) => t.length >= 7);
  let best = null;
  for (const e of COMPILED) {
    if (e.key.trim() === "") continue;
    if (INCOME_ONLY[e.cat] && !(amount > 0)) continue;
    if (SPEND_ONLY[e.cat] && amount > 0) continue;
    if (text.indexOf(e.key) === -1 && !(e.glued && tokens.some((t) => t.indexOf(e.glued) !== -1))) continue;
    if (!best || e.score > best.score) best = { name: e.cat, score: e.score };
  }
  if (!best && TOAST.test(rawText) && !(amount > 0)) best = { name: "Dining Out", score: 1 };
  return best;
}

// Short, stable merchant key used to remember the user's choices.
function merchantKey(tx) {
  const recurring = require(`${__hooks}/lib/recurring.js`);
  return recurring.normalizePayee(tx.payee || tx.description || "");
}

function loadRules(app, userId) {
  return app.findRecordsByFilter("rules", "user = {:u}", "-created", 0, 0, { u: userId })
    .map((r) => ({ pattern: r.getString("pattern").toLowerCase(), category: r.getString("category") }))
    .filter((r) => r.pattern);
}

function loadCategoryIndex(app, userId) {
  const byName = {};
  for (const c of app.findRecordsByFilter("categories", "user = {:u} && archived = false", "", 0, 0, { u: userId })) {
    byName[c.getString("name").toLowerCase()] = c.id;
  }
  return byName;
}

// Merchants the user has categorized by hand: key -> category id (most-used, most recent on ties).
function loadLearned(app, userId) {
  const votes = {};
  const txs = app.findRecordsByFilter("transactions", "user = {:u} && cat_manual = true && category != ''", "-date", 3000, 0, { u: userId });
  txs.forEach((t, i) => {
    const key = merchantKey({ payee: t.getString("payee"), description: t.getString("description") });
    if (!key || key.length < 3) return;
    const v = (votes[key] = votes[key] || {});
    const c = t.getString("category");
    v[c] = (v[c] || 0) + 1 + (txs.length - i) / (txs.length * 10); // small recency bonus
  });
  const learned = {};
  for (const key in votes) {
    let best = "", n = 0;
    for (const c in votes[key]) if (votes[key][c] > n) { best = c; n = votes[key][c]; }
    learned[key] = best;
  }
  return learned;
}

function context(app, userId) {
  let learned = {};
  try { learned = loadLearned(app, userId); } catch (_) { /* before the migration adds cat_manual */ }
  return { rules: loadRules(app, userId), byName: loadCategoryIndex(app, userId), learned };
}

function idFor(ctx, name) {
  let n = name;
  for (let i = 0; i < 3 && n; i++) {
    const id = ctx.byName[n.toLowerCase()];
    if (id) return id;
    n = FALLBACK[n];
  }
  return "";
}

// Returns a category id or "" for a transaction-like {description, payee, amount}.
function categorize(ctx, tx) {
  const raw = (tx.description || "") + " " + (tx.payee || "");
  const text = raw.toLowerCase();
  for (const r of ctx.rules) {
    if (text.indexOf(r.pattern) !== -1) return r.category;
  }
  const key = merchantKey(tx);
  if (key && ctx.learned && ctx.learned[key]) return ctx.learned[key];
  if (tx.hint) {
    const id = ctx.byName[String(tx.hint).toLowerCase()];
    if (id && !(INCOME_ONLY[tx.hint] && tx.amount <= 0)) return id;
  }
  const m = directoryMatch(raw, tx.amount);
  return m ? idFor(ctx, m.name) : "";
}

// Categorize every uncategorized transaction for a user. Returns the count changed.
function applyToUncategorized(app, userId) {
  const ctx = context(app, userId);
  const txs = app.findRecordsByFilter("transactions", "user = {:u} && category = ''", "", 0, 0, { u: userId });
  let n = 0;
  for (const t of txs) {
    const cat = categorize(ctx, {
      description: t.getString("description"), payee: t.getString("payee"), amount: t.getFloat("amount"),
    });
    if (cat) { t.set("category", cat); app.save(t); n++; }
  }
  return n;
}

// The pre-2.4 keyword guesses, kept only to spot transactions they filed so the new
// categorizer can re-file them. A transaction whose category differs from this guess was
// set by the user (or a rule) and is left alone.
const LEGACY = [
  [/payroll|direct dep|salary|paycheck/i, "Paycheck"],
  [/interest paid|dividend/i, "Other Income"],
  [/transfer|zelle to|xfer|online banking transfer/i, "Transfers"],
  [/payment.*(thank you|card)|autopay|credit card pmt|card payment/i, "Credit Card Payment"],
  [/rent|mortgage|landlord|apartment/i, "Rent / Mortgage"],
  [/electric|energy|water|utility|utilities|gas co|sewer|internet|comcast|xfinity|spectrum|verizon|at&t|t-mobile/i, "Utilities"],
  [/kroger|safeway|whole foods|trader joe|aldi|publix|heb|h-e-b|grocery|costco|wegmans|instacart/i, "Groceries"],
  [/shell|chevron|exxon|bp |mobil|fuel|uber|lyft|parking|toll|transit/i, "Transportation"],
  [/insurance|geico|state farm|progressive|allstate/i, "Insurance"],
  [/pharmacy|cvs|walgreens|doctor|medical|dental|clinic|hospital/i, "Health"],
  [/netflix|spotify|hulu|disney|youtube|apple\.com|prime video|hbo|max\.com|patreon|subscription/i, "Subscriptions"],
  [/restaurant|cafe|coffee|starbucks|doordash|grubhub|uber eats|mcdonald|chipotle|pizza|taco|grill|bar /i, "Dining Out"],
  [/amazon|target|walmart|best buy|etsy|ebay/i, "Shopping"],
];
function legacyGuess(text, amount) {
  for (const [re, name] of LEGACY) {
    if (!re.test(text)) continue;
    if (INCOME_ONLY[name] && amount <= 0) continue;
    return name;
  }
  return "";
}

// One-time pass: re-file transactions the old keyword guesses got wrong. Returns the count changed.
function refileLegacy(app, userId) {
  const ctx = context(app, userId);
  const nameById = {};
  for (const n in ctx.byName) nameById[ctx.byName[n]] = n;
  const txs = app.findRecordsByFilter("transactions", "user = {:u} && category != '' && cat_manual = false", "", 0, 0, { u: userId });
  let n = 0;
  for (const t of txs) {
    const tx = { description: t.getString("description"), payee: t.getString("payee"), amount: t.getFloat("amount") };
    const current = nameById[t.getString("category")];
    if (!current || legacyGuess((tx.description + " " + tx.payee).toLowerCase(), tx.amount).toLowerCase() !== current) continue;
    const next = categorize(ctx, tx);
    if (next && next !== t.getString("category")) { t.set("category", next); app.save(t); n++; }
  }
  return n;
}

// After the user hand-picks a category, give the same merchant's uncategorized transactions that category too.
function learnFrom(app, tx) {
  const key = merchantKey({ payee: tx.getString("payee"), description: tx.getString("description") });
  const cat = tx.getString("category");
  if (!key || key.length < 3 || !cat) return 0;
  const others = app.findRecordsByFilter("transactions", "user = {:u} && category = '' && id != {:id}", "", 0, 0,
    { u: tx.getString("user"), id: tx.id });
  let n = 0;
  for (const o of others) {
    if (merchantKey({ payee: o.getString("payee"), description: o.getString("description") }) !== key) continue;
    o.set("category", cat);
    app.save(o);
    n++;
  }
  return n;
}

const DEFAULT_CATEGORIES = [
  ["Paycheck", "income", 0, "💼"],
  ["Other Income", "income", 0, "💵"],
  ["Rent / Mortgage", "needs", 0, "🏠"],
  ["Utilities", "needs", 0, "💡"],
  ["Groceries", "needs", 0, "🛒"],
  ["Transportation", "needs", 0, "🚗"],
  ["Insurance", "needs", 0, "🛡️"],
  ["Health", "needs", 0, "🩺"],
  ["Education", "needs", 0, "🎓"],
  ["Fees & Charges", "needs", 0, "🧾"],
  ["Dining Out", "wants", 0, "🍽️"],
  ["Shopping", "wants", 0, "🛍️"],
  ["Subscriptions", "wants", 0, "📺"],
  ["Entertainment", "wants", 0, "🎟️"],
  ["Personal Care", "wants", 0, "💇"],
  ["Travel", "wants", 0, "✈️"],
  ["Home", "wants", 0, "🔨"],
  ["Pets", "wants", 0, "🐾"],
  ["Gifts", "wants", 0, "🎁"],
  ["Charity", "wants", 0, "💝"],
  ["Cash & ATM", "wants", 0, "🏧"],
  ["Emergency Fund", "savings", 0, "🧯"],
  ["Investing", "savings", 0, "📈"],
  ["Transfers", "transfer", 0, "🔁"],
  ["Credit Card Payment", "transfer", 0, "💳"],
];

// Creates any default category the user doesn't have yet (by name). Safe to run repeatedly.
function seedCategories(app, userId, only) {
  const col = app.findCollectionByNameOrId("categories");
  const have = {};
  for (const c of app.findRecordsByFilter("categories", "user = {:u}", "", 0, 0, { u: userId })) have[c.getString("name").toLowerCase()] = 1;
  for (const [name, kind, budget, icon] of DEFAULT_CATEGORIES) {
    if (have[name.toLowerCase()] || (only && only.indexOf(name) === -1)) continue;
    const r = new Record(col);
    r.set("user", userId);
    r.set("name", name);
    r.set("kind", kind);
    r.set("budget", budget);
    r.set("icon", icon);
    try { app.save(r); } catch (_) { /* already exists */ }
  }
}

module.exports = { context, categorize, applyToUncategorized, refileLegacy, seedCategories, learnFrom, directoryMatch, clean, DIRECTORY, REGIONAL };

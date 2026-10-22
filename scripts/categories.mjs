// Which tab(s) a story belongs in: Top (massive only), World (outside the US), U.S., Tech & AI.

const US_RE = /\b(u\.s\.|us (house|senate|army|navy|military|troops|economy|government|election|court)|united states|america'?s?|americans?|washington|white house|congress\w*|senate|senators?|house (republicans|democrats|speaker|vote|passes|committee)|speaker johnson|supreme court|scotus|trump\w*|vance|biden|harris|obama|gop|republicans?|democrats?|maga|governor|gov\.|fbi|doj|justice department|ice agents?|immigration (raid|agents|crackdown)|deportation|irs|fda|cdc|fema|pentagon|hegseth|rubio|bondi|patel|rfk|kennedy jr|ocasio-cortez|aoc|schumer|ilhan omar|pelosi|newsom|desantis|mamdani|elon musk|musk|midterms?|electoral|super pac|wall street|federal (judge|court|government|agents?)|national guard|new york|nyc|california|texas|florida|chicago|los angeles|l\.a\.|san francisco|seattle|boston|atlanta|miami|philadelphia|washington, d\.c\.|d\.c\.|alabama|alaska|arizona|arkansas|colorado|connecticut|delaware|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|utah|vermont|virginia|wisconsin|wyoming)\b/i;

const FOREIGN_RE = /\b(iran\w*|israel\w*|gaza|hamas|hezbollah|lebanon|syria\w*|iraq\w*|yemen|houthis?|saudi\w*|qatar|uae|emirates|turkey|turkish|erdogan|egypt\w*|russia\w*|putin|kremlin|moscow|ukrain\w*|zelensk\w*|kyiv|belarus|china|chinese|beijing|xi jinping|taiwan\w*|hong kong|japan\w*|tokyo|korea\w*|pyongyang|kim jong|india\w*|modi|pakistan\w*|afghan\w*|bangladesh|indonesia\w*|philippines|vietnam\w*|thailand|myanmar|australia\w*|new zealand|europe\w*|eu|european union|nato|un|united nations|britain|british|uk|u\.k\.|england|london|starmer|scotland|ireland|france|french|paris|macron|germany|german|berlin|merz|italy|italian|meloni|spain|spanish|poland|polish|netherlands|dutch|belgium|sweden|norway|denmark|finland|greece|hungary|orban|serbia|romania|switzerland|swiss|vatican|pope|africa\w*|nigeria\w*|kenya\w*|ethiopia\w*|sudan\w*|somalia|congo|south africa|libya|morocco|algeria|mexic\w*|canad\w*|carney|brazil\w*|lula|argentin\w*|milei|venezuela\w*|maduro|colombia\w*|cuba\w*|chile|peru|haiti)\b/i;

const FIGURE_RE = /\b(trump|melania|vance|elon musk|musk|ocasio-cortez|aoc|schumer|ilhan omar|pelosi|newsom|desantis|mamdani|rfk|kennedy jr|marjorie taylor greene|mtg|jeffries|mcconnell|speaker johnson|tucker carlson|candace owens|ben shapiro|charlie kirk|joe rogan|bernie sanders|obama|biden|harris|hegseth|rubio|bondi|kash patel|epstein|diddy|kanye|taylor swift|mrbeast|kai cenat|adin ross|ishowspeed|hasan ?piker|xqc|pokimane)\b/i;
const VIRAL_RE = /\b(viral|backlash|outrage|slams|blasts|rips|meltdown|feud|controversy|controversial|apologi[sz]es|cancel(l)?ed|fired|resigns|sparks? (outrage|debate|backlash|fury)|furious|mocked|mocks|roasted|heated|clash(es)?|walks out|explodes|scandal|leaked|caught on camera|goes off on|trending)\b/i;
const CRIME_RE = /\b(trial|verdict|jury|sentenced|indicted|indictment|arrested|charged|convicted|acquitted|shooting|shooter|murder\w*|homicide|stabbing|kidnapp\w*|manhunt|police|fbi raid)\b/i;
const CULTURE_RE = /\b(box office|flops?|bombs at|opening weekend|concert|tour|album|single|grammys?|oscars?|emmys?|golden globes|super bowl halftime|halftime show|netflix|hbo|disney|marvel|movie|film|trailer|sequel|hollywood|celebrit\w*|rapper|singer|actor|actress|comedian|comedy|stand-up|late-night|talk show|snl|podcast|kanye|ye\b|drake|taylor swift|beyonce|kardashian|diddy|met gala|red carpet|influencer|reality (tv|show)|feud|beef|diss)\b/i;
const SERIOUS_CRIME_RE = /\b(serial killer|murder\w*|homicide|mass shooting|shooting|shooter|manhunt|kidnapp\w*|trial|verdict|jury|sentenced|convicted|acquitted|indicted|charged with|true crime)\b/i;
const STREAM_RE = /\b(streamer|twitch|kick|youtuber|tiktok(er)?|influencer|podcast(er)?|livestream\w*)\b/i;

const TECH_RE = /\b(ai|a\.i\.|artificial intelligence|openai|anthropic|deepmind|chatgpt|claude|gemini|grok|xai|llama|mistral|llms?|chatbots?|machine learning|nvidia|tsmc|semiconductors?|chipmakers?|chips? (export|ban|maker|plant|shortage)|gpus?|data cent(er|re)s?|apple|iphone|ipad|google|alphabet|microsoft|windows|meta|instagram|whatsapp|amazon|aws|tesla|spacex|starlink|neuralink|robot\w*|humanoid|quantum|cyber\w*|hack(ed|ers?|ing)?|ransomware|data breach|smartphones?|android|samsung|startup|unicorn|app store|antitrust|big tech|silicon valley|software|cloud|crypto exchange|deepfakes?|autonomous|self-driving|waymo|drones? maker)\b/i;

// Truly massive: shown in Top
const MASSIVE_RE = /\b(declares? war|war (breaks out|erupts)|invasion|invades?|launches? (attack|strikes|offensive|invasion)|nuclear|coup|assassinat\w*|killed (dozens|hundreds|scores)|dozens (killed|dead)|hundreds (killed|dead)|\d{2,} (killed|dead)|death toll|massacre|explosion|blast|earthquake|tsunami|hurricane|typhoon|cyclone|wildfires?|landfall|plane crash|crash kills|terror(ist)? attack|mass shooting|state of emergency|martial law|pandemic|outbreak|elected|wins? (election|presidency|vote)|election (results?|victory)|landslide|resigns|ousted|impeach\w*|dies|dead at|died|ceasefire|peace (deal|agreement)|market crash|stocks plunge|rate (cut|hike)|default|collapse|historic|unprecedented|record)\b/i;

// Stricter: big enough to put a story on Top the moment one major newsroom reports it
const URGENT_RE = /\b(declares? war|war (breaks out|erupts)|invasion|invades?|launches? (attack|strikes|offensive|invasion)|nuclear (strike|attack|test|weapon)|coup|assassinat\w*|killed (dozens|hundreds|scores)|dozens (killed|dead)|hundreds (killed|dead)|\d{2,} (killed|dead)|death toll|massacre|earthquake|tsunami|makes landfall|plane crash|terror(ist)? attack|mass shooting|martial law|state of emergency|ceasefire|peace (deal|agreement)|market crash|stocks (plunge|crash))\b/i;

const DISASTER_RE = /\b(earthquake|quake|tsunami|volcan\w*|eruption|hurricane|typhoon|cyclone|tornado(es)?|floods?|flooding|landslide|wildfires?|bushfires?|heatwave|blizzard|avalanche|famine|epidemic|outbreak|plane crash|train (crash|derailment)|ferry (sinks|capsizes)|building collapse|explosion|blast)\b/i;

const has = (re, t) => re.test(t);

export function classify(title, summary, feedCats, score, tier, outletCount, breaking) {
  const t = title;
  const usHit = has(US_RE, t), foreignHit = has(FOREIGN_RE, t);
  const cats = new Set();
  const fromUS = feedCats.has('us'), fromWorld = feedCats.has('world'), fromTech = feedCats.has('tech');

  // U.S. vs World
  if (fromUS || fromWorld) {
    if (usHit && !foreignHit) cats.add('us');
    else if (foreignHit && !usHit) cats.add('world');
    else if (usHit && foreignHit) { cats.add('world'); cats.add('us'); }
    else cats.add(fromUS ? 'us' : 'world');
  } else if (usHit && !foreignHit && (has(FIGURE_RE, t) || has(CRIME_RE, t) || has(VIRAL_RE, t) || has(CULTURE_RE, t))) {
    cats.add('us'); // e.g. a business or tech story that is really a U.S. politics story
  }

  // Disasters and genuinely big breaking news show in World too, wherever they happen
  if (has(DISASTER_RE, t) || (breaking && has(MASSIVE_RE, t))) cats.add('world');

  // Tech & AI: tech feeds, plus tech stories from anywhere else
  if (fromTech || has(TECH_RE, t)) cats.add('tech');

  const flags = [];
  if (has(CULTURE_RE, t)) flags.push('culture');
  if (has(VIRAL_RE, t)) flags.push('viral');
  if (has(SERIOUS_CRIME_RE, t)) flags.push('crime');
  if (has(STREAM_RE, t)) flags.push('stream');
  if (has(DISASTER_RE, t)) flags.push('disaster');

  // Top: only genuinely massive stories
  const massive = has(MASSIVE_RE, t);
  const top = (score >= 55 && outletCount >= 3) || (score >= 50 && outletCount >= 5) || (breaking && outletCount >= 2) || (massive && score >= 40 && outletCount >= 2);

  return { cats, flags, top, massive, urgent: has(URGENT_RE, t) };
}

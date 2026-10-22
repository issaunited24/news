// Which tab(s) a story belongs in: Top (massive only), World (outside the US), U.S., Tech & AI,
// Sports (NBA, NFL and UFC, plus only the biggest moments in other sports), Entertainment, Science.

const US_RE = /\b(u\.s\.|us (house|senate|army|navy|military|troops|economy|government|election|court)|united states|america'?s?|americans?|washington|white house|congress\w*|senate|senators?|house (republicans|democrats|speaker|vote|passes|committee)|speaker johnson|supreme court|scotus|trump\w*|vance|biden|harris|obama|gop|republicans?|democrats?|maga|governor|gov\.|fbi|doj|justice department|ice agents?|immigration (raid|agents|crackdown)|deportation|irs|fda|cdc|fema|pentagon|hegseth|rubio|bondi|patel|rfk|kennedy jr|ocasio-cortez|aoc|schumer|ilhan omar|pelosi|newsom|desantis|mamdani|elon musk|musk|midterms?|electoral|super pac|wall street|federal (judge|court|government|agents?)|national guard|new york|nyc|california|texas|florida|chicago|los angeles|l\.a\.|san francisco|seattle|boston|atlanta|miami|philadelphia|washington, d\.c\.|d\.c\.|alabama|alaska|arizona|arkansas|colorado|connecticut|delaware|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|utah|vermont|virginia|wisconsin|wyoming)\b/i;

const FOREIGN_RE = /\b(iran\w*|israel\w*|gaza|hamas|hezbollah|lebanon|syria\w*|iraq\w*|yemen|houthis?|saudi\w*|qatar|uae|emirates|turkey|turkish|erdogan|egypt\w*|russia\w*|putin|kremlin|moscow|ukrain\w*|zelensk\w*|kyiv|belarus|china|chinese|beijing|xi jinping|taiwan\w*|hong kong|japan\w*|tokyo|korea\w*|pyongyang|kim jong|india\w*|modi|pakistan\w*|afghan\w*|bangladesh|indonesia\w*|philippines|vietnam\w*|thailand|myanmar|australia\w*|new zealand|europe\w*|eu|european union|nato|un|united nations|britain|british|uk|u\.k\.|england|london|starmer|scotland|ireland|france|french|paris|macron|germany|german|berlin|merz|italy|italian|meloni|spain|spanish|poland|polish|netherlands|dutch|belgium|sweden|norway|denmark|finland|greece|hungary|orban|serbia|romania|switzerland|swiss|vatican|pope|africa\w*|nigeria\w*|kenya\w*|ethiopia\w*|sudan\w*|somalia|congo|south africa|libya|morocco|algeria|mexic\w*|canad\w*|carney|brazil\w*|lula|argentin\w*|milei|venezuela\w*|maduro|colombia\w*|cuba\w*|chile|peru|haiti)\b/i;

const FIGURE_RE = /\b(trump|melania|vance|elon musk|musk|ocasio-cortez|aoc|schumer|ilhan omar|pelosi|newsom|desantis|mamdani|rfk|kennedy jr|marjorie taylor greene|mtg|jeffries|mcconnell|speaker johnson|tucker carlson|candace owens|ben shapiro|charlie kirk|joe rogan|bernie sanders|obama|biden|harris|hegseth|rubio|bondi|kash patel|epstein|diddy|kanye|taylor swift|mrbeast|kai cenat|adin ross|ishowspeed|hasan ?piker|xqc|pokimane)\b/i;
const VIRAL_RE = /\b(viral|backlash|outrage|slams|blasts|rips|meltdown|feud|controversy|controversial|apologi[sz]es|cancel(l)?ed|fired|resigns|sparks? (outrage|debate|backlash|fury)|furious|mocked|mocks|roasted|heated|clash(es)?|walks out|explodes|scandal|leaked|caught on camera|goes off on|trending)\b/i;
const CRIME_RE = /\b(trial|verdict|jury|sentenced|indicted|indictment|arrested|charged|convicted|acquitted|shooting|shooter|murder\w*|homicide|stabbing|kidnapp\w*|manhunt|police|fbi raid)\b/i;
const CULTURE_RE = /\b(box office|flops?|bombs at|opening weekend|concert|tour|album|single|grammys?|oscars?|emmys?|golden globes|super bowl halftime|halftime show|netflix|hbo|disney|marvel|movie|film|trailer|sequel|hollywood|celebrit\w*|rapper|singer|actor|actress|comedian|comedy|stand-up|late-night|talk show|snl|podcast|kanye|ye\b|drake|taylor swift|beyonce|kardashian|diddy|met gala|red carpet|influencer|reality (tv|show)|feud|beef|diss)\b/i;
const SERIOUS_CRIME_RE = /\b(serial killer|murder\w*|homicide|mass shooting|shooting|shooter|manhunt|kidnapp\w*|trial|verdict|jury|sentenced|convicted|acquitted|indicted|charged with|true crime)\b/i;
const STREAM_RE = /\b(streamer|twitch|kick|youtuber|tiktok(er)?|influencer|podcast(er)?|livestream\w*)\b/i;

const TECH_RE = /\b(ai|a\.i\.|artificial intelligence|openai|anthropic|deepmind|chatgpt|claude|gemini|grok|xai|llama|mistral|llms?|chatbots?|machine learning|nvidia|tsmc|semiconductors?|chipmakers?|chips? (export|ban|maker|plant|shortage)|gpus?|data cent(er|re)s?|apple|iphone|ipad|google|alphabet|microsoft|windows|meta|instagram|whatsapp|amazon|aws|tesla|spacex|starlink|neuralink|robot\w*|humanoid|quantum|cyber\w*|hack(ed|ers?|ing)?|ransomware|data breach|smartphones?|android|samsung|startup|unicorn|app store|antitrust|big tech|silicon valley|software|cloud|crypto exchange|deepfakes?|autonomous|self-driving|waymo|drones? maker)\b/i;

// Sports. NBA, NFL and UFC always count; other sports only when it's a big moment.
const SPORTS_RE = /\b(nba|nfl|ufc|mma|wnba|mlb|nhl|ncaa|super bowl|world series|stanley cup|playoffs?|quarterback|touchdown|wide receiver|running back|point guard|slam dunk|free agen(cy|t)|draft pick|head coach|coach(es|ed)?\b|knockout|title fight|octagon|soccer|football club|premier league|champions league|la liga|serie a|bundesliga|fifa|world cup|grand prix|formula (1|one)|\bf1\b|nascar|tennis|wimbledon|us open|french open|australian open|golf|pga|masters tournament|ryder cup|olympic\w*|boxing|cricket|innings|test series|rugby|marathon|athlete|striker|midfielder|goalkeeper|transfer window|hat-?trick|tournament|championship game|semifinal|quarterfinal|(first|second|third|fourth|fifth) test)\b/i;
const NBA_NFL_UFC_RE = /\b(nba|nfl|ufc|mma|super bowl|quarterback|touchdown|wide receiver|running back|point guard|octagon|title fight|dana white|lakers|celtics|warriors|knicks|nets|bulls|bucks|suns|mavericks|mavs|nuggets|clippers|76ers|sixers|raptors|cavaliers|cavs|pistons|pacers|hawks|hornets|orlando magic|miami heat|utah jazz|wizards|oklahoma city thunder|okc thunder|rockets|spurs|grizzlies|pelicans|timberwolves|trail blazers|sacramento kings|chiefs|eagles|cowboys|patriots|packers|49ers|niners|buffalo bills|ravens|bengals|steelers|browns|new york jets|ny jets|new york giants|ny giants|dolphins|detroit lions|chicago bears|vikings|la rams|los angeles rams|seahawks|arizona cardinals|falcons|saints|buccaneers|carolina panthers|commanders|texans|colts|jaguars|tennessee titans|broncos|raiders|chargers|lebron|steph curry|stephen curry|mahomes|jokic|wembanyama|giannis|luka don[cč]i[cć]|shai gilgeous|anthony edwards|jayson tatum|kevin durant|josh allen|lamar jackson|joe burrow|travis kelce|jalen hurts|conor mcgregor|jon jones|islam makhachev|alex pereira|khabib)\b/i;
// Which sport a story is about (used to mix sports evenly in the Sports tab)
const SOCCER_RE = /\b(soccer|football club|premier league|champions league|europa league|la liga|serie a|bundesliga|ligue 1|mls|fifa|uefa|world cup|fa cup|carabao|ballon d'or|transfer window|arsenal|chelsea|liverpool|tottenham|spurs boss|man(chester)? (united|city|utd)|newcastle united|aston villa|real madrid|barcelona|atletico|bayern|dortmund|psg|paris saint-germain|juventus|inter milan|ac milan|napoli|messi|ronaldo|haaland|mbapp[eé]|salah|bellingham|vinicius|yamal|kane|pep guardiola|arteta|ancelotti|mourinho|goalkeeper|striker|midfielder|penalty shootout|hat-?trick|clean sheet)\b/i;
const UFC_RE = /\b(ufc|mma|octagon|dana white|title fight|bellator|pfl|conor mcgregor|jon jones|islam makhachev|alex pereira|khabib|tom aspinall|ilia topuria|sean o'malley|belal muhammad|dricus du plessis|khamzat|merab|paddy pimblett|boxing|knockout|undisputed|heavyweight champion)\b/i;
const NBA_RE = /\b(nba|wnba|basketball|lakers|celtics|warriors|knicks|nets|bulls|bucks|nuggets|clippers|76ers|sixers|raptors|cavaliers|cavs|pistons|pacers|timberwolves|grizzlies|pelicans|trail blazers|lebron|steph curry|stephen curry|jokic|wembanyama|giannis|luka don[cč]i[cć]|shai gilgeous|anthony edwards|jayson tatum|kevin durant|point guard|slam dunk)\b/i;
const NFL_RE = /\b(nfl|super bowl|quarterback|touchdown|wide receiver|running back|chiefs|eagles|cowboys|patriots|packers|49ers|niners|buffalo bills|ravens|bengals|steelers|browns|jets|giants|dolphins|lions|bears|vikings|rams|seahawks|falcons|saints|buccaneers|commanders|texans|colts|jaguars|titans|broncos|raiders|chargers|mahomes|josh allen|lamar jackson|joe burrow|travis kelce|jalen hurts)\b/i;
const BIG_SPORTS_RE = /\b(wins? (the )?(title|championship|world cup|final|gold|grand slam|masters|series)|world cup (final|winner)|olympic\w* (gold|record)|world record|champions league final|grand slam|retires?|retirement|dies|dead at|died|banned|suspended|scandal|arrested|record-breaking|historic)\b/i;

// Entertainment: movies, TV, music, celebrities, streamers
const ENT_RE = /\b(box office|opening weekend|teaser|first look|release date|in theaters|premiere|prequel|reboot|biopic|casting|joins (the )?cast|a24|pixar|dc studios|star wars|movie|film|trailer|sequel|hollywood|netflix|hbo|disney\+?|marvel|pixar|streaming|tv series|season \d|showrunner|sitcom|late-night|talk show|snl|oscars?|emmys?|grammys?|golden globes|tony awards|met gala|red carpet|album|single|music video|concert|(world|stadium|arena|reunion|farewell|north american|u\.?s\.?|european|summer|fall|spring|winter) tour|rapper|singer|pop star|actor|actress|director|comedian|stand-up|celebrit\w*|kardashian|taylor swift|beyonc[eé]|drake|kanye|rihanna|billie eilish|bad bunny|streamer|twitch|youtuber|influencer|tiktok star|reality (tv|show)|documentary)\b/i;

// Science: space, health and medicine, discoveries
const SCI_RE = /\b(nasa|esa\b|spacex launch|starship|rocket launch|astronaut|space station|\biss\b|moon landing|lunar|mars (rover|mission|lander|sample)|on mars|to mars|asteroid|comet|meteor|black hole|milky way|distant galax\w*|nebula|telescope|james webb|hubble|exoplanet|astronom\w*|cosmic|universe|scientists? (find|found|discover\w*|say|warn|reveal\w*)|researchers (find|found|discover\w*)|study (finds|shows|suggests)|new study|clinical trial|breakthrough|vaccine|cancer (treatment|drug|cure)|alzheimer|dementia|gene therapy|crispr|dna|genome|stem cells?|fossil|dinosaur|archaeolog\w*|ancient (tomb|city|remains)|species|physicists?|quantum physics|particle|neuroscien\w*|brain study|medical breakthrough|outbreak|pandemic|ebola|measles|bird flu|bacteria|antibiotic|fda approv\w*)\b/i;

// Truly massive: shown in Top
const MASSIVE_RE = /\b(declares? war|war (breaks out|erupts)|invasion|invades?|launches? (attack|strikes|offensive|invasion)|nuclear|coup|assassinat\w*|killed (dozens|hundreds|scores)|dozens (killed|dead)|hundreds (killed|dead)|\d{2,} (killed|dead)|death toll|massacre|explosion|blast|earthquake|tsunami|hurricane|typhoon|cyclone|wildfires?|landfall|plane crash|crash kills|terror(ist)? attack|mass shooting|state of emergency|martial law|pandemic|outbreak|elected|wins? (election|presidency|vote)|election (results?|victory)|landslide|resigns|ousted|impeach\w*|dies|dead at|died|ceasefire|peace (deal|agreement)|market crash|stocks plunge|rate (cut|hike)|default|collapse|historic|unprecedented|record)\b/i;

// Stricter: big enough to put a story on Top the moment one major newsroom reports it
const URGENT_RE = /\b(declares? war|war (breaks out|erupts)|invasion|invades?|launches? (attack|strikes|offensive|invasion)|nuclear (strike|attack|test|weapon)|coup|assassinat\w*|killed (dozens|hundreds|scores)|dozens (killed|dead)|hundreds (killed|dead)|\d{2,} (killed|dead)|death toll|massacre|earthquake|tsunami|makes landfall|plane crash|terror(ist)? attack|mass shooting|martial law|state of emergency|ceasefire|peace (deal|agreement)|market crash|stocks (plunge|crash))\b/i;

const DISASTER_RE = /\b(earthquake|quake|tsunami|volcan\w*|eruption|hurricane|typhoon|cyclone|tornado(es)?|floods?|flooding|landslide|wildfires?|bushfires?|heatwave|blizzard|avalanche|famine|epidemic|outbreak|plane crash|train (crash|derailment)|ferry (sinks|capsizes)|building collapse|explosion|blast)\b/i;


// Your picks for each tab. A story matching one gets a small push in that tab (shows a bit more and a bit higher),
// but the tab still carries everything else too.
const LIKES = [
  // World
  ['war', /\b(war|wars|missile|missiles|drone strikes?|air ?strikes?|strikes? on|shelling|offensive|troops|frontline|front line|invasion|ceasefire|truce|hostages?|militants?|rebels?|insurgents?|fighting|clashes|bombing|bombard\w*|artillery|military (operation|escalation)|gaza|hamas|hezbollah|houthis?|ukrain\w*|kyiv|idf|nato)\b/i],
  ['europe', /\b(europe\w*|eu\b|european (union|commission|parliament)|brussels|britain|british|u\.?k\.?\b|england|london|downing street|starmer|labour|tories|conservatives|reform uk|farage|scotland|ireland|france|french|paris|macron|germany|german|berlin|merz|bundestag|afd|italy|meloni|spain|s[aá]nchez|poland|hungary|orban|netherlands|sweden|norway|denmark|finland|greece|romania)\b/i],
  ['asia', /\b(china|chinese|beijing|xi jinping|taiwan\w*|hong kong|japan\w*|tokyo|takaichi|ishiba|korea\w*|seoul|pyongyang|kim jong|india\w*|modi|pakistan\w*|indonesia\w*|philippines|vietnam\w*|thailand|myanmar|south china sea|asean|asia\w*)\b/i],
  // U.S.
  ['trump', /\b(trump\w*|white house|oval office|vance|executive order|leavitt|melania|mar-a-lago|administration)\b/i],
  ['congress', /\b(congress\w*|senate|senators?|house (republicans|democrats|speaker|vote|passes|committee|gop)|speaker johnson|shutdown|filibuster|midterms?|election\w*|primary|primaries|ballot|polls? (show|shows|finds)|voters?|campaign|redistricting|governor'?s race|mayoral)\b/i],
  ['crime', /\b(trial|verdict|jury|sentenced|indicted|indictment|arrested|charged|convicted|acquitted|murder\w*|homicide|shooting|manhunt|kidnapp\w*|serial killer|true crime|prosecutors?|lawsuit|sued|judge (rules|blocks|orders))\b/i],
  ['viral', /\b(viral|backlash|outrage|slams|blasts|rips|meltdown|feud|controvers\w*|apologi[sz]es|fired|sparks?|furious|mocked|roasted|heated|clash(es)?|scandal|leaked|caught on camera|trending|streamer|influencer|tiktok)\b/i],
  // Entertainment
  ['movies', /\b(trailer|teaser|first look|release date|sets? (premiere|release)|coming (to theaters|soon)|in theaters|upcoming (movie|film)|premiere|sequel|prequel|reboot|remake|spinoff|cast(s|ing)? (as|in)|joins (the )?cast|greenlights?|green-?lit|first trailer|official trailer|director'?s cut|franchise|marvel|dc studios|star wars|pixar|disney|warner bros|universal|paramount|a24|netflix (film|movie)|biopic)\b/i],
  ['boxoffice', /\b(box office|opening weekend|weekend (box office|ticket sales|grosses)|grosses|ticket sales|tops box office|debuts? (with|to) \$|\$\d+(\.\d+)? ?(m|million|b|billion) (opening|debut|worldwide|globally|domestic)|flops?|bombs?|record opening|highest-grossing|worldwide total|cinemascore)\b/i],
  ['music', /\b(album|single|song|music video|tour|concert|grammys?|billboard (hot 100|200)|chart(s|-topping)|no\. 1|rapper|singer|pop star|band|festival|coachella|celebrit\w*|kardashian|taylor swift|beyonc[eé]|drake|kanye|rihanna|billie eilish|bad bunny|sabrina carpenter|travis kelce|engaged|divorce|split|dating|red carpet|met gala)\b/i],
  // Sports
  ['results', /\b(beat|beats|defeat\w*|edge[sd]?|rout\w*|thrash\w*|crush\w*|stun\w*|win|wins|won|draw|draws|held to|late (goal|winner)|equali[sz]er|hat-?trick|scores?|scored|goals?|\d+-\d+|victory|comeback|clinch\w*|advance\w*|eliminat\w*|knocked out of|final score|result)\b/i],
  ['fight', /\b(ufc|mma|bellator|pfl|boxing|title fight|fight night|main event|co-main|undisputed|knockout|\bko\b|tko|submission|split decision|unanimous decision|weigh-?in|face-?off|octagon|dana white|callout|calls out|vacates?|belt)\b/i],
  ['upset', /\b(upset|shock\w*|stun\w*|stunning|giant-?killing|underdog|record|records|all-time|historic|history|first ever|first time|milestone|career-high|unbeaten|streak|perfect season)\b/i],
  // Tech & AI
  ['ai', /\b(ai|a\.i\.|artificial intelligence|openai|anthropic|deepmind|chatgpt|claude|gemini|grok|xai|llama|mistral|deepseek|qwen|llms?|chatbots?|agi|sam altman|dario amodei|demis hassabis|ai models?|ai agents?)\b/i],
  ['bigtech', /\b(apple|google|alphabet|microsoft|meta|amazon|nvidia|tesla|netflix|big tech|tim cook|sundar pichai|satya nadella|zuckerberg|bezos|jensen huang|antitrust)\b/i],
  ['chips', /\b(chips?|chipmakers?|semiconductors?|nvidia|tsmc|intel|amd|qualcomm|arm|asml|samsung foundry|gpus?|blackwell|rubin|export (controls|ban)|fab|foundry|robot\w*|humanoid|optimus|figure ai|boston dynamics|robotaxis?|waymo|self-driving|autonomous|drones?)\b/i],
  // Science
  ['space', /\b(nasa|esa\b|isro|jaxa|spacex|starship|falcon 9|rocket|launch(es|ed)?|astronauts?|space station|\biss\b|artemis|moon|lunar|mars|asteroid|comet|meteor|black holes?|galax\w*|nebula|telescope|james webb|jwst|hubble|exoplanets?|astronom\w*|cosmic|universe|solar (flare|storm|eclipse)|aurora|northern lights|satellite|orbit)\b/i],
  ['health', /\b(cancer|tumou?r|alzheimer'?s|dementia|parkinson'?s|diabetes|obesity|ozempic|wegovy|glp-1|heart (disease|attack)|stroke|vaccines?|clinical trial|breakthrough|cure|gene therapy|crispr|stem cells?|fda (approv\w*|clears)|new drug|longevity|aging|ageing|lifespan|outbreak|virus|pandemic|bird flu|measles|antibiotic|superbug|brain)\b/i],
  ['weird', /\b(ancient|archaeolog\w*|fossils?|dinosaurs?|mummy|mummies|tomb|ruins|skeleton|shipwreck|neanderthal|prehistoric|new species|deep[- ]sea|creature|bizarre|strange|weird|mysterious|mystery|surprising|first[- ]ever|never[- ]before[- ]seen|oldest|earliest|scientists (are )?(baffled|stunned|puzzled)|unexplained)\b/i],
];
export const LIKE_TAB = { war: 'world', europe: 'world', asia: 'world', trump: 'us', congress: 'us', crime: 'us', viral: 'us', movies: 'ent', boxoffice: 'ent', music: 'ent', results: 'sports', fight: 'sports', upset: 'sports', ai: 'tech', bigtech: 'tech', chips: 'tech', space: 'sci', health: 'sci', weird: 'sci' };

const has = (re, t) => re.test(t);

export function classify(title, summary, feedCats, score, tier, outletCount, breaking) {
  const t = title, ts = `${title} ${summary || ''}`.slice(0, 500);
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

  // Sports: sports feeds, or clearly a sports story. It leaves World and U.S. unless it's huge or viral.
  const sportsHit = feedCats.has('sports') || (has(SPORTS_RE, t) && !/\b(golf|tennis|baseball|softball)[- ]ball|hail\b/i.test(t));
  // Previews, odds, fantasy, surveys and college or high school games don't count as NBA/NFL/UFC news
  const SPORTS_FLUFF = /\b(survey|reacts|how to watch|where to watch|odds|best bets?|picks|predictions?|fantasy|mailbag|livestream|live stream|high school|college|ncaa|recruit\w*|mock draft|power rankings|takeaways|grades|week \d+ (preview|picks))\b/i;
  const big3 = sportsHit && !SPORTS_FLUFF.test(t) && (has(NBA_NFL_UFC_RE, t) || (feedCats.has('sports') && has(NBA_NFL_UFC_RE, ts)));
  if (sportsHit) {
    cats.add('sports');
    if (!has(MASSIVE_RE, t) && !has(VIRAL_RE, t)) { cats.delete('world'); if (!has(FIGURE_RE, t)) cats.delete('us'); }
  }
  // Entertainment: entertainment feeds or clearly entertainment (pop culture also stays in U.S.)
  if (feedCats.has('ent') || (!sportsHit && (has(ENT_RE, t) || has(STREAM_RE, t)))) cats.add('ent');
  // Science: science feeds or clearly a science, space or health discovery
  if (feedCats.has('sci') || has(SCI_RE, t)) cats.add('sci');

  // Tech & AI: tech feeds, plus tech stories from anywhere else
  if (fromTech || has(TECH_RE, t)) cats.add('tech');

  const flags = [];
  if (has(CULTURE_RE, t)) flags.push('culture');
  if (has(VIRAL_RE, t)) flags.push('viral');
  if (has(SERIOUS_CRIME_RE, t)) flags.push('crime');
  if (has(STREAM_RE, t)) flags.push('stream');
  if (has(DISASTER_RE, t)) flags.push('disaster');
  if (big3) flags.push('big3');
  if (sportsHit && has(BIG_SPORTS_RE, t)) flags.push('bigsport');
  const sport = !sportsHit ? null : has(SOCCER_RE, t) ? 'soccer' : has(UFC_RE, t) ? 'ufc' : has(NBA_RE, t) ? 'nba' : has(NFL_RE, t) ? 'nfl' : has(SOCCER_RE, ts) ? 'soccer' : has(UFC_RE, ts) ? 'ufc' : 'other';
  if (sportsHit && SPORTS_FLUFF.test(t)) flags.push('sportfluff');

  // Top: only genuinely massive stories
  const massive = has(MASSIVE_RE, t);
  const top = (score >= 55 && outletCount >= 3) || (score >= 50 && outletCount >= 5) || (breaking && outletCount >= 2) || (massive && score >= 40 && outletCount >= 2);

  // Your picks: only tags for tabs this story is actually in
  const likes = LIKES.filter(([k, re]) => cats.has(LIKE_TAB[k]) && re.test(t)).map(([k]) => k);

  return { cats, flags, top, massive, urgent: has(URGENT_RE, t), sport, likes };
}

//
// ═══════════════════════════════════════════════════════════════════
//   BACCARAT GLADIATOR — EXTENDED THEMES
//   42 new stages + 10 seasonal rotations.
//   Loaded as a classic <script> by stage-select.html and
//   baccarat-game.html. Exposes a single namespace on window.
//
//   IMPORTANT — gameplay safety:
//   These themes only paint the page background, glow halo, header
//   tint, and chip glow. Cards (.card-face) and the road scoreboards
//   keep their hard-coded high-contrast colors. Adding a theme MUST
//   NOT introduce CSS that targets .card-face, .scoreboards, or any
//   road canvas wrapper.
// ═══════════════════════════════════════════════════════════════════
//
window.BG_THEMES_EXTENDED = (function () {
  'use strict';

  // ── 42 NEW STAGES ─────────────────────────────────────────────
  // Slotted into existing tiers so the difficulty/progression shape
  // matches the original 60. Each entry mirrors the existing stage
  // shape ({slug, name, tag, region, tier}) plus a `palette` (CSS
  // variable values matching the venue var contract) and a
  // `bgGradient` used as the carousel-card art when no preview JPG
  // is available yet.
  const STAGES = [
    // ── T1 — WELCOME PIT ──────────────────────────────────────
    { slug:'candy-rush', name:'Candy Rush', tag:'Lollipop lane · sugar high', region:'🍭', tier:1,
      bgGradient:'linear-gradient(135deg,#ff7fb6 0%,#c1438a 50%,#3a0f24 100%)',
      palette:{ bg1:'#3a1428', bg2:'#16080f', glow:'rgba(255,140,200,0.30)', line:'rgba(255,200,220,0.28)', city:'Candy Rush' } },
    { slug:'farm-country', name:'Farm & Country', tag:'Wheat field · red barn', region:'🌾', tier:1,
      bgGradient:'linear-gradient(135deg,#d8a64a 0%,#5e7a2a 55%,#1a2410 100%)',
      palette:{ bg1:'#2a3318', bg2:'#0a0f08', glow:'rgba(220,180,80,0.26)', line:'rgba(200,220,140,0.26)', city:'Farm Country' } },
    { slug:'birds-paradise', name:'Birds of Paradise', tag:'Toucan canopy · jewel feathers', region:'🦜', tier:1,
      bgGradient:'linear-gradient(135deg,#ff8a3c 0%,#1e8a6a 55%,#0a2018 100%)',
      palette:{ bg1:'#0e3028', bg2:'#040c0a', glow:'rgba(255,160,60,0.28)', line:'rgba(120,255,200,0.28)', city:'Birds of Paradise' } },

    // ── T2 — INDIE BLOCK ──────────────────────────────────────
    { slug:'fruit-classic', name:'Classic Fruits', tag:'Cherry · lemon · bar', region:'🍒', tier:2,
      bgGradient:'linear-gradient(135deg,#e83a3a 0%,#a21010 50%,#2a0606 100%)',
      palette:{ bg1:'#3a0c0c', bg2:'#160404', glow:'rgba(255,80,80,0.30)', line:'rgba(255,200,40,0.32)', city:'Classic Fruits' } },
    { slug:'sevens-bars', name:'Sevens & Bars', tag:'Triple seven · payline gold', region:'🎰', tier:2,
      bgGradient:'linear-gradient(135deg,#ffd040 0%,#a05a08 55%,#1a0a02 100%)',
      palette:{ bg1:'#3a1c04', bg2:'#160a02', glow:'rgba(255,200,40,0.34)', line:'rgba(255,180,60,0.30)', city:'Sevens & Bars' } },
    { slug:'arcade-8bit', name:'Retro Arcade', tag:'CRT scanlines · insert coin', region:'🕹️', tier:2,
      bgGradient:'linear-gradient(135deg,#ff40c8 0%,#5a18d8 55%,#080020 100%)',
      palette:{ bg1:'#1a0048', bg2:'#08001a', glow:'rgba(0,255,180,0.30)', line:'rgba(255,80,200,0.32)', city:'Retro Arcade' } },
    { slug:'pinball', name:'Pinball', tag:'Flipper bumpers · tilt warning', region:'🎱', tier:2,
      bgGradient:'linear-gradient(135deg,#ff7040 0%,#5a3a4a 50%,#0a0810 100%)',
      palette:{ bg1:'#2c2030', bg2:'#0e0810', glow:'rgba(255,120,80,0.30)', line:'rgba(180,200,220,0.30)', city:'Pinball Alley' } },

    // ── T3 — FAR HORIZONS ─────────────────────────────────────
    { slug:'egypt', name:'Ancient Egypt', tag:'Karnak · pharaoh’s vault', region:'🇪🇬', tier:3,
      bgGradient:'linear-gradient(135deg,#d4a64a 0%,#7a5418 50%,#1a0f06 100%)',
      palette:{ bg1:'#3a2812', bg2:'#16100a', glow:'rgba(240,200,80,0.30)', line:'rgba(80,180,200,0.28)', city:'Ancient Egypt' } },
    { slug:'aztec', name:'Aztec & Mayan', tag:'Jade temple · stone calendar', region:'🛕', tier:3,
      bgGradient:'linear-gradient(135deg,#3aa078 0%,#1a5040 55%,#08180e 100%)',
      palette:{ bg1:'#1a3828', bg2:'#080f0c', glow:'rgba(220,140,60,0.28)', line:'rgba(80,220,160,0.30)', city:'Aztec Empire' } },
    { slug:'imperial-china', name:'Imperial China', tag:'Forbidden City · jade dragons', region:'🏯', tier:3,
      bgGradient:'linear-gradient(135deg,#e83a3a 0%,#7a0c0c 55%,#1a0202 100%)',
      palette:{ bg1:'#3a0a0a', bg2:'#160202', glow:'rgba(255,200,60,0.32)', line:'rgba(255,160,120,0.28)', city:'Imperial China' } },
    { slug:'feudal-japan', name:'Feudal Japan', tag:'Shogun keep · cherry petals', region:'⛩️', tier:3,
      bgGradient:'linear-gradient(135deg,#ffb0c0 0%,#3a1424 55%,#080308 100%)',
      palette:{ bg1:'#1a0a14', bg2:'#080406', glow:'rgba(255,160,180,0.28)', line:'rgba(220,200,180,0.24)', city:'Feudal Japan' } },
    { slug:'vikings', name:'Vikings & Norse', tag:'Longship harbor · iron horns', region:'🛶', tier:3,
      bgGradient:'linear-gradient(135deg,#7896b8 0%,#1c2c44 55%,#040810 100%)',
      palette:{ bg1:'#1a2838', bg2:'#070d14', glow:'rgba(120,180,220,0.28)', line:'rgba(180,200,220,0.26)', city:'Viking Hold' } },

    // ── T4 — UNDERGROUND ──────────────────────────────────────
    { slug:'wild-west', name:'Wild West', tag:'Saloon dust · last stagecoach', region:'🤠', tier:4,
      bgGradient:'linear-gradient(135deg,#e8893a 0%,#7a3a14 50%,#1a0a04 100%)',
      palette:{ bg1:'#3a1f0e', bg2:'#160a04', glow:'rgba(255,140,60,0.30)', line:'rgba(220,180,100,0.30)', city:'Wild West' } },
    { slug:'medieval', name:'Medieval', tag:'Castle hall · torch & banner', region:'🏰', tier:4,
      bgGradient:'linear-gradient(135deg,#a86838 0%,#3a2820 55%,#0e0908 100%)',
      palette:{ bg1:'#2a1c14', bg2:'#0e0908', glow:'rgba(255,140,60,0.30)', line:'rgba(180,160,120,0.26)', city:'Medieval Hall' } },
    { slug:'renaissance', name:'Renaissance', tag:'Florence · velvet & gilt', region:'🎨', tier:4,
      bgGradient:'linear-gradient(135deg,#d4a050 0%,#5a1a38 55%,#16080f 100%)',
      palette:{ bg1:'#3a1428', bg2:'#160810', glow:'rgba(220,180,100,0.30)', line:'rgba(220,160,180,0.28)', city:'Renaissance' } },
    { slug:'greek-myth', name:'Greek Myth', tag:'Olympus · marble & lightning', region:'⚡', tier:4,
      bgGradient:'linear-gradient(135deg,#d8d0a8 0%,#1c2c46 55%,#040810 100%)',
      palette:{ bg1:'#1c2c46', bg2:'#0a121e', glow:'rgba(220,200,140,0.28)', line:'rgba(120,180,220,0.30)', city:'Mt. Olympus' } },

    // ── T5 — POSTCARD CITIES ──────────────────────────────────
    { slug:'tomb-raid', name:'Tomb Raid', tag:'Booby-trap corridor · idol', region:'🗿', tier:5,
      bgGradient:'linear-gradient(135deg,#e89538 0%,#5c2a08 55%,#10080a 100%)',
      palette:{ bg1:'#2c1a0a', bg2:'#100804', glow:'rgba(255,160,60,0.30)', line:'rgba(180,140,80,0.28)', city:'Tomb Raid' } },
    { slug:'pirate', name:'Pirate Treasure', tag:'Galleon hold · doubloon stack', region:'🏴‍☠️', tier:5,
      bgGradient:'linear-gradient(135deg,#3aa0c8 0%,#0e2c3a 55%,#040c14 100%)',
      palette:{ bg1:'#0e2c3a', bg2:'#040e16', glow:'rgba(255,200,80,0.30)', line:'rgba(200,160,80,0.28)', city:'Pirate Cove' } },
    { slug:'deep-sea', name:'Deep Sea', tag:'Bathysphere · bioluminescent', region:'🐙', tier:5,
      bgGradient:'linear-gradient(135deg,#3aa0e8 0%,#0a1a3a 55%,#020614 100%)',
      palette:{ bg1:'#0a1a3a', bg2:'#020614', glow:'rgba(80,200,255,0.32)', line:'rgba(60,160,200,0.30)', city:'Deep Sea' } },
    { slug:'steampunk', name:'Steampunk Airship', tag:'Brass gauges · valve hiss', region:'⚙️', tier:5,
      bgGradient:'linear-gradient(135deg,#d8893a 0%,#5c3a14 55%,#160a04 100%)',
      palette:{ bg1:'#2a1c14', bg2:'#0e0904', glow:'rgba(220,140,60,0.32)', line:'rgba(200,160,80,0.30)', city:'Aether Skies' } },
    { slug:'noir-detective', name:'Noir Detective', tag:'Gumshoe · neon rain', region:'🕵️', tier:5,
      bgGradient:'linear-gradient(135deg,#d8c890 0%,#3a3024 55%,#0a0804 100%)',
      palette:{ bg1:'#1a1814', bg2:'#080604', glow:'rgba(220,200,140,0.22)', line:'rgba(180,160,100,0.24)', city:'Noir Mystery' } },

    // ── T6 — CHAMPIONSHIP ─────────────────────────────────────
    { slug:'wizards', name:'Wizards & Magic', tag:'Spellbook ledger · sigil glow', region:'🧙', tier:6,
      bgGradient:'linear-gradient(135deg,#b878ff 0%,#3a14a0 55%,#0a0418 100%)',
      palette:{ bg1:'#1c0a3a', bg2:'#080418', glow:'rgba(180,80,255,0.30)', line:'rgba(200,160,255,0.30)', city:'Wizard Tower' } },
    { slug:'dragon-realm', name:'Dragon Realm', tag:'High fantasy · wyvern hoard', region:'🐉', tier:6,
      bgGradient:'linear-gradient(135deg,#ff5028 0%,#7a1a0a 55%,#160404 100%)',
      palette:{ bg1:'#3a0a08', bg2:'#160404', glow:'rgba(255,80,40,0.32)', line:'rgba(255,160,80,0.30)', city:'Dragon Realm' } },
    { slug:'witches', name:'Witches & Potions', tag:'Cauldron room · raven perch', region:'🧪', tier:6,
      bgGradient:'linear-gradient(135deg,#80e040 0%,#1a3818 55%,#070d06 100%)',
      palette:{ bg1:'#1a2814', bg2:'#070d06', glow:'rgba(120,255,80,0.28)', line:'rgba(180,140,255,0.28)', city:'Coven Lodge' } },
    { slug:'arthurian', name:'Arthurian Legend', tag:'Round table · grail beam', region:'⚔️', tier:6,
      bgGradient:'linear-gradient(135deg,#c8d8ff 0%,#1a2440 55%,#080d1c 100%)',
      palette:{ bg1:'#1a2440', bg2:'#080d1c', glow:'rgba(180,200,255,0.28)', line:'rgba(220,200,180,0.28)', city:'Camelot' } },
    { slug:'dinosaurs', name:'Jurassic', tag:'Amber park · raptor pack', region:'🦖', tier:6,
      bgGradient:'linear-gradient(135deg,#a8d058 0%,#1a3018 55%,#070f08 100%)',
      palette:{ bg1:'#1a3018', bg2:'#070f08', glow:'rgba(220,180,80,0.28)', line:'rgba(140,200,100,0.28)', city:'Jurassic' } },
    { slug:'lucha-libre', name:'Lucha Libre', tag:'Plata o oro · midnight bout', region:'🎭', tier:6,
      bgGradient:'linear-gradient(135deg,#ffd040 0%,#a01838 55%,#160408 100%)',
      palette:{ bg1:'#3a0e1a', bg2:'#160408', glow:'rgba(255,200,40,0.32)', line:'rgba(220,200,220,0.30)', city:'Lucha Libre' } },

    // ── T7 — NEON STREETS ─────────────────────────────────────
    { slug:'vampires', name:'Vampires Gothic', tag:'Carpathian throne · velvet drip', region:'🦇', tier:7,
      bgGradient:'linear-gradient(135deg,#d83050 0%,#3a0814 55%,#100408 100%)',
      palette:{ bg1:'#2c0810', bg2:'#100408', glow:'rgba(255,40,80,0.30)', line:'rgba(180,120,140,0.28)', city:'Carpathia' } },
    { slug:'haunted', name:'Haunted House', tag:'Cobweb chandelier · creaking floor', region:'👻', tier:7,
      bgGradient:'linear-gradient(135deg,#a878ff 0%,#1a0a2c 55%,#080410 100%)',
      palette:{ bg1:'#1a0a2c', bg2:'#080410', glow:'rgba(160,120,255,0.28)', line:'rgba(200,180,220,0.24)', city:'Haunted House' } },
    { slug:'aliens', name:'Aliens & UFOs', tag:'Tractor beam · area 51', region:'👽', tier:7,
      bgGradient:'linear-gradient(135deg,#40ffa0 0%,#0c4030 55%,#040908 100%)',
      palette:{ bg1:'#0c1a18', bg2:'#040908', glow:'rgba(80,255,160,0.32)', line:'rgba(120,255,200,0.30)', city:'Hangar 51' } },
    { slug:'mad-scientist', name:'Mad Scientist', tag:'Tesla coil · beaker glow', region:'🧫', tier:7,
      bgGradient:'linear-gradient(135deg,#40e8c0 0%,#0a3040 55%,#040c14 100%)',
      palette:{ bg1:'#0a2030', bg2:'#040c14', glow:'rgba(80,255,200,0.32)', line:'rgba(255,200,80,0.30)', city:'Mad Lab' } },
    { slug:'comics', name:'Comic Books', tag:'Halftone POW · primary punch', region:'💥', tier:7,
      bgGradient:'linear-gradient(135deg,#ff4030 0%,#1a1a78 55%,#080820 100%)',
      palette:{ bg1:'#1a1a48', bg2:'#080820', glow:'rgba(255,80,40,0.32)', line:'rgba(255,200,40,0.32)', city:'Comic City' } },
    { slug:'time-travel', name:'Time Travel', tag:'Chrono drift · era streak', region:'⏳', tier:7,
      bgGradient:'linear-gradient(135deg,#40c0ff 0%,#0a1a48 55%,#040814 100%)',
      palette:{ bg1:'#0a1a30', bg2:'#040814', glow:'rgba(80,200,255,0.32)', line:'rgba(255,180,80,0.30)', city:'Chrono Drift' } },
    { slug:'zombies', name:'Outbreak', tag:'Quarantine zone · last stand', region:'🧟', tier:7,
      bgGradient:'linear-gradient(135deg,#98c038 0%,#6a1818 55%,#08120a 100%)',
      palette:{ bg1:'#1a2814', bg2:'#070d06', glow:'rgba(120,200,40,0.32)', line:'rgba(220,80,80,0.30)', city:'Outbreak Zone' } },

    // ── T8 — VIP ESCAPE ───────────────────────────────────────
    { slug:'gold-bullion', name:'Gold Bullion', tag:'Vault stacks · 24-karat shine', region:'🥇', tier:8,
      bgGradient:'linear-gradient(135deg,#ffd040 0%,#7a5008 55%,#1a1004 100%)',
      palette:{ bg1:'#3a2a08', bg2:'#1a1004', glow:'rgba(255,200,40,0.34)', line:'rgba(255,220,120,0.32)', city:'Gold Vault' } },
    { slug:'wall-street', name:'Wall Street', tag:'Pinstripe pit · ticker blur', region:'📈', tier:8,
      bgGradient:'linear-gradient(135deg,#a0d840 0%,#3a3814 55%,#0a0804 100%)',
      palette:{ bg1:'#1a1814', bg2:'#080604', glow:'rgba(180,200,80,0.24)', line:'rgba(220,200,140,0.24)', city:'Wall Street' } },
    { slug:'crypto', name:'Crypto Vault', tag:'Cold storage · glyph keys', region:'₿', tier:8,
      bgGradient:'linear-gradient(135deg,#ff9028 0%,#5a2c08 55%,#160a04 100%)',
      palette:{ bg1:'#2a1808', bg2:'#100804', glow:'rgba(255,160,40,0.32)', line:'rgba(255,200,80,0.30)', city:'Crypto Vault' } },
    { slug:'royal-court', name:'Royal Court', tag:'Throne room · crown jewels', region:'👑', tier:8,
      bgGradient:'linear-gradient(135deg,#d83a5a 0%,#5a0a18 55%,#160408 100%)',
      palette:{ bg1:'#3a0a1a', bg2:'#160408', glow:'rgba(255,200,80,0.32)', line:'rgba(220,180,100,0.28)', city:'Royal Court' } },
    { slug:'runway', name:'Fashion Runway', tag:'Spotlight · couture march', region:'👗', tier:8,
      bgGradient:'linear-gradient(135deg,#ff70d8 0%,#3a0838 55%,#0e0408 100%)',
      palette:{ bg1:'#2a0820', bg2:'#0e0408', glow:'rgba(255,80,200,0.30)', line:'rgba(255,180,220,0.28)', city:'Runway' } },

    // ── T9 — ROYAL CIRCUIT ────────────────────────────────────
    { slug:'venice', name:'Venice Carnival', tag:'Mask & gondola · lagoon dusk', region:'🎭', tier:9,
      bgGradient:'linear-gradient(135deg,#d4a058 0%,#0a3838 55%,#040c10 100%)',
      palette:{ bg1:'#0a2c30', bg2:'#040c10', glow:'rgba(220,160,200,0.28)', line:'rgba(180,200,220,0.28)', city:'Venice' } },
    { slug:'bollywood', name:'Bollywood', tag:'Saffron silks · jasmine drum', region:'🇮🇳', tier:9,
      bgGradient:'linear-gradient(135deg,#ff9028 0%,#7a0a28 55%,#160408 100%)',
      palette:{ bg1:'#3a0a1c', bg2:'#160408', glow:'rgba(255,160,40,0.32)', line:'rgba(255,200,80,0.30)', city:'Bollywood' } },
    { slug:'paris', name:'Parisian Romance', tag:'Tour Eiffel · café rosé', region:'🇫🇷', tier:9,
      bgGradient:'linear-gradient(135deg,#f8c0c8 0%,#3a1830 55%,#100808 100%)',
      palette:{ bg1:'#2c1820', bg2:'#100808', glow:'rgba(255,200,200,0.28)', line:'rgba(220,180,160,0.28)', city:'Paris' } },
    { slug:'hollywood', name:'Hollywood', tag:'Klieg lights · red carpet', region:'🎬', tier:9,
      bgGradient:'linear-gradient(135deg,#ffc040 0%,#7a0a08 55%,#160404 100%)',
      palette:{ bg1:'#3a0e0a', bg2:'#160404', glow:'rgba(255,200,80,0.32)', line:'rgba(255,160,40,0.30)', city:'Hollywood' } },
  ];

  // ── 10 SEASONAL STAGES ────────────────────────────────────────
  // Surface only when today's date falls inside the window. They sit
  // outside the tier ladder (always-unlocked) and appear at the end
  // of the stage carousel under a SEASONAL header.
  // Window format: { startMonth, startDay, endMonth, endDay }, 1-12 / 1-31.
  // A window where startMonth > endMonth wraps the year (e.g. NYE).
  const SEASONAL = [
    { slug:'christmas', name:'Christmas', tag:'Hearth & holly · gift wrap stripes', region:'🎄', tier:11, seasonal:true,
      window:{ startMonth:12, startDay:1,  endMonth:12, endDay:31 },
      bgGradient:'linear-gradient(135deg,#e83838 0%,#1a3018 50%,#080f08 100%)',
      palette:{ bg1:'#1a3018', bg2:'#080f08', glow:'rgba(255,80,40,0.32)', line:'rgba(255,220,80,0.32)', city:'Christmas' } },
    { slug:'halloween', name:'Halloween', tag:'Jack-o’-lantern · cobweb chandelier', region:'🎃', tier:11, seasonal:true,
      window:{ startMonth:10, startDay:1,  endMonth:10, endDay:31 },
      bgGradient:'linear-gradient(135deg,#ff8a18 0%,#3a0a48 55%,#100408 100%)',
      palette:{ bg1:'#2c1404', bg2:'#100804', glow:'rgba(255,140,40,0.32)', line:'rgba(160,80,255,0.30)', city:'Halloween' } },
    { slug:'new-years', name:'New Year’s Eve', tag:'Confetti · midnight champagne', region:'🎆', tier:11, seasonal:true,
      window:{ startMonth:12, startDay:26, endMonth:1,  endDay:7 },
      bgGradient:'linear-gradient(135deg,#ffd040 0%,#1a2848 55%,#040814 100%)',
      palette:{ bg1:'#0a1428', bg2:'#040814', glow:'rgba(255,220,80,0.32)', line:'rgba(160,200,255,0.28)', city:'New Year’s Eve' } },
    { slug:'valentines', name:'Valentine’s Day', tag:'Rose velvet · candy hearts', region:'💝', tier:11, seasonal:true,
      window:{ startMonth:2,  startDay:1,  endMonth:2,  endDay:20 },
      bgGradient:'linear-gradient(135deg,#ff5080 0%,#7a0a28 55%,#160408 100%)',
      palette:{ bg1:'#3a0a1c', bg2:'#160408', glow:'rgba(255,80,140,0.32)', line:'rgba(255,180,200,0.30)', city:'Valentine’s Day' } },
    { slug:'st-patricks', name:'St. Patrick’s', tag:'Emerald shamrock · pub stout', region:'☘️', tier:11, seasonal:true,
      window:{ startMonth:3,  startDay:10, endMonth:3,  endDay:20 },
      bgGradient:'linear-gradient(135deg,#40e878 0%,#0c4020 55%,#040c08 100%)',
      palette:{ bg1:'#0a2c14', bg2:'#040c08', glow:'rgba(80,255,140,0.30)', line:'rgba(255,220,80,0.30)', city:'St. Patrick’s' } },
    { slug:'easter', name:'Easter', tag:'Pastel meadow · chocolate egg', region:'🐣', tier:11, seasonal:true,
      window:{ startMonth:3,  startDay:20, endMonth:4,  endDay:30 },
      bgGradient:'linear-gradient(135deg,#ffd0a0 0%,#3a5a30 55%,#080f0c 100%)',
      palette:{ bg1:'#1a3a30', bg2:'#080f0c', glow:'rgba(255,200,140,0.28)', line:'rgba(180,255,200,0.28)', city:'Easter' } },
    { slug:'thanksgiving', name:'Thanksgiving', tag:'Harvest amber · pumpkin pie', region:'🦃', tier:11, seasonal:true,
      window:{ startMonth:11, startDay:15, endMonth:11, endDay:30 },
      bgGradient:'linear-gradient(135deg,#e89028 0%,#5c2a0a 55%,#160c04 100%)',
      palette:{ bg1:'#3a200a', bg2:'#160c04', glow:'rgba(255,160,40,0.30)', line:'rgba(220,180,80,0.28)', city:'Thanksgiving' } },
    { slug:'patriotic', name:'Patriotic', tag:'Stars & stripes · skyrocket', region:'🎇', tier:11, seasonal:true,
      window:{ startMonth:7,  startDay:1,  endMonth:7,  endDay:10 },
      bgGradient:'linear-gradient(135deg,#e83838 0%,#0a1840 55%,#040820 100%)',
      palette:{ bg1:'#0a1840', bg2:'#040820', glow:'rgba(255,60,60,0.30)', line:'rgba(220,220,255,0.30)', city:'Patriotic' } },
    { slug:'summer-beach', name:'Summer Beach', tag:'Turquoise tide · tiki bar', region:'🏖️', tier:11, seasonal:true,
      window:{ startMonth:6,  startDay:15, endMonth:8,  endDay:31 },
      bgGradient:'linear-gradient(135deg,#40d8d8 0%,#0a3848 55%,#040c14 100%)',
      palette:{ bg1:'#0a3040', bg2:'#040c14', glow:'rgba(255,200,80,0.32)', line:'rgba(80,220,220,0.30)', city:'Summer Beach' } },
    { slug:'winter-wonder', name:'Winter Wonderland', tag:'Snow drift · pine spires', region:'❄️', tier:11, seasonal:true,
      window:{ startMonth:1,  startDay:1,  endMonth:2,  endDay:28 },
      bgGradient:'linear-gradient(135deg,#c8e0ff 0%,#0e2438 55%,#040c14 100%)',
      palette:{ bg1:'#0e2438', bg2:'#040c14', glow:'rgba(180,220,255,0.30)', line:'rgba(220,240,255,0.28)', city:'Winter Wonderland' } },
  ];

  // ── Lookup helpers ────────────────────────────────────────────
  const ALL = STAGES.concat(SEASONAL);
  const BY_SLUG = Object.create(null);
  for (let i=0;i<ALL.length;i++) BY_SLUG[ALL[i].slug] = ALL[i];

  function getBySlug(slug) { return BY_SLUG[slug] || null; }

  // Returns the seasonals whose window contains `date` (default: now).
  // Wrap-around windows (startMonth > endMonth, e.g. Dec 26 → Jan 7)
  // are handled by treating the range as two segments.
  function getActiveSeasonalStages(date) {
    const d = date || new Date();
    const m = d.getMonth() + 1; // 1-12
    const day = d.getDate();
    return SEASONAL.filter(function (s) {
      const w = s.window;
      const inSeg = function (sm, sd, em, ed) {
        if (m < sm || m > em) return false;
        if (m === sm && day < sd) return false;
        if (m === em && day > ed) return false;
        return true;
      };
      if (w.startMonth <= w.endMonth) {
        return inSeg(w.startMonth, w.startDay, w.endMonth, w.endDay);
      }
      // wraps year boundary — split into [start..Dec31] and [Jan1..end]
      return inSeg(w.startMonth, w.startDay, 12, 31) ||
             inSeg(1, 1, w.endMonth, w.endDay);
    });
  }

  // ── Runtime theme application ─────────────────────────────────
  // Writes the theme's palette as inline CSS variables on <body>.
  // Inline style beats stylesheet specificity, so this overrides
  // any body[data-venue='...'] CSS rules without removing them.
  // Marks body[data-themed='1'] so safety CSS in baccarat-game.html
  // can keep cards + roads protected.
  function applyTheme(slugOrEntry) {
    if (!document || !document.body) return false;
    const entry = typeof slugOrEntry === 'string' ? getBySlug(slugOrEntry) : slugOrEntry;
    if (!entry || !entry.palette) return false;
    const p = entry.palette;
    const b = document.body;
    b.style.setProperty('--venue-bg1',  p.bg1);
    b.style.setProperty('--venue-bg2',  p.bg2);
    b.style.setProperty('--venue-glow', p.glow);
    b.style.setProperty('--venue-line', p.line);
    b.style.setProperty('--venue-city', '"' + (p.city || entry.name) + '"');
    b.setAttribute('data-themed', '1');
    b.setAttribute('data-theme-slug', entry.slug);
    return true;
  }

  // Read ?theme=<slug> from current URL and apply if present.
  function applyThemeFromUrl() {
    try {
      const params = new URLSearchParams(window.location.search);
      const slug = params.get('theme');
      if (slug) return applyTheme(slug);
    } catch (e) { /* no-op */ }
    return false;
  }

  return {
    STAGES: STAGES,
    SEASONAL: SEASONAL,
    getBySlug: getBySlug,
    getActiveSeasonalStages: getActiveSeasonalStages,
    applyTheme: applyTheme,
    applyThemeFromUrl: applyThemeFromUrl,
  };
})();

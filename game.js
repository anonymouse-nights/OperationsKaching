/* =========================================================
   Town Trade - game.js (General Store path implemented)
   - General Store: inventory + pricing + no passive income
   - Other roles: keep old style (income per second + serve)
   Requires: ascii.js loads BEFORE this file
   ========================================================= */

var SAVE_KEY = "townTrade_cb_style_v5";

/* =========================
   GENERAL STORE CONFIG
   ========================= */

// Starting state for General Store
var GS_START_MONEY = 200;
var GS_START_REP = 0;

// Item catalog (simple starter set)
var GS_ITEMS = [
  {
    key: "apples",
    name: "Apples",
    buyIn: 40,          // cost to start selling (license + first crate)
    unitCost: 1,        // restock cost per item
    startStock: 25,
    // price guidance
    lowPrice: 2,
    fairMin: 3,
    fairMax: 5,
    highPrice: 6
  },
  {
    key: "candles",
    name: "Candles",
    buyIn: 60,
    unitCost: 2,
    startStock: 20,
    lowPrice: 3,
    fairMin: 4,
    fairMax: 7,
    highPrice: 9
  },
  {
    key: "flour",
    name: "Flour Sacks",
    buyIn: 80,
    unitCost: 3,
    startStock: 18,
    lowPrice: 4,
    fairMin: 6,
    fairMax: 9,
    highPrice: 12
  },
  {
    key: "cloth",
    name: "Cloth Rolls",
    buyIn: 110,
    unitCost: 5,
    startStock: 14,
    lowPrice: 7,
    fairMin: 10,
    fairMax: 14,
    highPrice: 18
  }
];

// Restock defaults
var GS_RESTOCK_DEFAULT_QTY = 10;

// Roleplay event chance on a "fair" sale
var GS_EVENT_CHANCE = 0.18; // 18%

/* =========================
   Upgrades / realism costs
   (General Store only for now)
   ========================= */
var COST_CART_TO_STALL = 1500;       // permit + materials
var COST_STALL_TO_STOREFRONT = 12000; // lease + renovation

/* =========================
   Bank (kept, later unlock)
   ========================= */
var LOAN_CASH_AMOUNT = 200;
var LOAN_DEBT_AMOUNT = 220;   // debt gets +10% immediately
var REPAY_PER_CLICK = 10;
// ongoing interest (you said you like it)
var INTEREST_EVERY_SECONDS = 12;
var INTEREST_RATE = 0.02;

/* -----------------------------
   Roles (kept as-is for later)
-------------------------------- */
var ROLES = {
  general_store: {
    name: "General Store",
    intro: "You set up shop selling essentials. Flour, cloth, candles… whatever keeps the town alive.",
    baseIncome: 1.0,
    serveMoney: 8,
    serveRep: 2
  },
  blacksmith: {
    name: "Blacksmith",
    intro: "You start with a small forge corner. Fewer customers, bigger payouts.",
    baseIncome: 1.0,
    serveMoney: 10,
    serveRep: 1
  },
  boarding_house: {
    name: "Boarding House",
    intro: "You begin by renting a spare room and offering meals. Reputation spreads fast in a small town.",
    baseIncome: 1.0,
    serveMoney: 7,
    serveRep: 3
  }
};

// Keep generic stages for other roles
var STAGES_GENERIC = ["Stage 1", "Stage 2", "Stage 3"];

/* -----------------------------
   Runtime state
-------------------------------- */
var s = null;
var tickHandle = null;
var notice = { text: "", type: "" };

/* -----------------------------
   Crash display
-------------------------------- */
window.onerror = function (msg, url, line, col) {
  try {
    var ss = document.getElementById("saveStatus");
    if (ss) ss.textContent = "ERROR: " + msg + " (line " + line + ")";
  } catch (e) {}
  return false;
};

/* -----------------------------
   DOM helpers
-------------------------------- */
function $(id){ return document.getElementById(id); }

function setHTML(id, html){
  var el = $(id);
  if(!el) return;
  el.innerHTML = html;
}

function setText(id, text){
  var el = $(id);
  if(!el) return;
  el.textContent = text;
}

function show(id){
  var el = $(id);
  if(!el){
    console.warn("Missing element id:", id);
    return;
  }
  el.hidden = false;
  el.classList.remove("hidden");
}

function hide(id){
  var el = $(id);
  if(!el){
    console.warn("Missing element id:", id);
    return;
  }
  el.hidden = true;
  el.classList.add("hidden");
}

function money(n){
  n = Math.floor(n);
  return "$" + n.toString();
}

function clamp(n, a, b){
  if(n < a) return a;
  if(n > b) return b;
  return n;
}

function setNotice(text, type){
  notice.text = text || "";
  notice.type = type || "";
}

/* -----------------------------
   New game state
-------------------------------- */
function newState(roleKey){
  return {
    roleKey: roleKey,

    money: 50,
    reputation: 60,
    stage: 0,
    debt: 0,

    // general store economics
    gs: {
      itemKey: null,
      itemName: "",
      unitCost: 0,
      stock: 0,
      sellPrice: 0,
      nextDiscount: 0,     // applies to next sale
      pricingHint: ""      // cached hint text
    },

    gazetteSupported: false,

    // old-style modifiers (kept for other roles)
    incomeBonus: 0,
    repGainBonus: 0,
    demand: 1.0,

    seconds: 0,
    served: 0,
    goodServed: 0,
    badServed: 0,

    unlocked: {
      stall: false,
      storefront: false,
      newspaperOffer: false,
      bank: false
    },

    logLines: []
  };
}

/* -----------------------------
   Log
-------------------------------- */
function log(msg){
  if(!s) return;
  var ts = new Date().toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});
  s.logLines.unshift("[" + ts + "] " + msg);
  if(s.logLines.length > 18) s.logLines.pop();
  renderLog();
}

function renderLog(){
  if(!s) return;
  setText("log", s.logLines.join("\n"));
}

/* -----------------------------
   Stage name (General Store themed)
-------------------------------- */
function stageName(){
  if(!s) return "Stage 1";
  if(s.roleKey === "general_store"){
    return ["Cart", "Market Stall", "Storefront"][s.stage] || "Cart";
  }
  return STAGES_GENERIC[s.stage] || "Stage 1";
}

/* -----------------------------
   Economy
   - General Store has NO passive income
   - Other roles keep passive income
-------------------------------- */
function incomePerSecond(){
  if(!s) return 0;
  if(s.roleKey === "general_store") return 0;

  var role = ROLES[s.roleKey];
  var stageBonus = s.stage * 0.8;
  return (role.baseIncome + stageBonus + s.incomeBonus) * s.demand;
}

/* -----------------------------
   UI reset
-------------------------------- */
function hideAllActionButtons(){
  hide("serveBtn");
  hide("goodDeedBtn");
  hide("advertiseBtn");
  hide("loanBtn");
  hide("repayBtn");
}

function resetUIBeforeStart(){
  hide("role_line");
  hide("money_line");
  hide("rep_line");
  hide("stage_line");
  hide("income_line");
  hide("story_line");
  hide("log");

  hideAllActionButtons();
  hide("upgrade_block");
  hide("upgradeToStallBtn");
  hide("upgradeToStoreBtn");
  hide("hireHelpBtn");
  hide("unlockNewsBtn");

  // We'll create a restock button dynamically in JS (no index edits)
  if($("restockBtn")) hide("restockBtn");

  hide("ascii_display");
  hide("town_features");
  hide("ascii_gazette");
  hide("ascii_bank");
}

/* -----------------------------
   Ensure Restock button exists
   (creates it under the action buttons area)
-------------------------------- */
function ensureRestockButton(){
  if($("restockBtn")) return;

  var serveBtn = $("serveBtn");
  if(!serveBtn) return;

  var btn = document.createElement("button");
  btn.id = "restockBtn";
  btn.className = "home_button hidden";
  btn.onclick = function(){ restockInventory(); };
  btn.textContent = "Restock inventory";

  // Insert after "serve" button
  serveBtn.parentNode.insertBefore(btn, serveBtn.nextSibling);
}

/* -----------------------------
   General Store setup flow
-------------------------------- */
function gsPickItemFlow(){
  var choices = "Choose what to sell:\n";
  for(var i=0;i<GS_ITEMS.length;i++){
    var it = GS_ITEMS[i];
    choices += (i+1) + ") " + it.name +
      " (Buy-in " + money(it.buyIn) + ", Restock " + money(it.unitCost) + "/each)\n";
  }

  var raw = prompt(choices, "1");
  if(raw === null) return false;

  var idx = parseInt(raw, 10) - 1;
  if(isNaN(idx) || idx < 0 || idx >= GS_ITEMS.length){
    alert("Please type 1, 2, 3, or 4.");
    return gsPickItemFlow();
  }

  var item = GS_ITEMS[idx];

  if(s.money < item.buyIn){
    alert("You don't have enough for that buy-in. Pick a cheaper item or restart.");
    return gsPickItemFlow();
  }

  // Pay buy-in and set initial stock/pricing model
  s.money -= item.buyIn;
  s.gs.itemKey = item.key;
  s.gs.itemName = item.name;
  s.gs.unitCost = item.unitCost;
  s.gs.stock = item.startStock;

  s.gs.pricingHint =
    "Pricing guide for " + item.name + ":\n" +
    "- Too low: ≤ " + money(item.lowPrice) + "\n" +
    "- Fair: " + money(item.fairMin) + " to " + money(item.fairMax) + "\n" +
    "- Too high: ≥ " + money(item.highPrice);

  log("You chose to sell " + item.name + ". Buy-in paid: " + money(item.buyIn) + ".");
  return true;
}

function gsSetPriceFlow(){
  var msg =
    "Set your selling price for " + s.gs.itemName + " (whole dollars).\n\n" +
    s.gs.pricingHint + "\n\n" +
    "Type a number like 4:";

  var raw = prompt(msg, "4");
  if(raw === null) return false;

  var p = parseInt(raw, 10);
  if(isNaN(p) || p <= 0){
    alert("Please type a whole dollar amount (example: 4).");
    return gsSetPriceFlow();
  }

  s.gs.sellPrice = p;
  log("You set your price: " + s.gs.itemName + " for " + money(p) + ".");
  return true;
}

/* -----------------------------
   Button labels (General Store-aware)
-------------------------------- */
function updateButtonLabels(){
  ensureRestockButton();

  // Serve button becomes Sell(item) for General Store
  if($("serveBtn")){
    if(s && s.roleKey === "general_store" && s.gs.itemName){
      setText("serveBtn", "Sell (" + s.gs.itemName + ")");
    } else {
      setText("serveBtn", "Serve a customer");
    }
  }

  // Discount = choose amount
  if($("goodDeedBtn")){
    setText("goodDeedBtn", "Offer discount…");
  }

  // Restock button text
  if($("restockBtn")){
    if(s && s.roleKey === "general_store"){
      setText("restockBtn", "Restock (" + money(s.gs.unitCost) + " each)");
    } else {
      setText("restockBtn", "Restock");
    }
  }

  // Bank buttons
  if($("loanBtn")) setText("loanBtn", "Take a small bank loan (" + money(LOAN_CASH_AMOUNT) + ")");
  if($("repayBtn")) setText("repayBtn", "Repay debt (" + money(REPAY_PER_CLICK) + ")");

  // Advertise (kept for later)
  if($("advertiseBtn") && s){
    var adCost = 30 + (s.stage * 10);
    setText("advertiseBtn", "Run a small advertisement (" + money(adCost) + ")");
  }

  // Upgrades: General Store uses realistic costs
  if($("upgradeToStallBtn")){
    var costA = (s && s.roleKey === "general_store") ? COST_CART_TO_STALL : 120;
    setText("upgradeToStallBtn", "Upgrade: Cart → Stall (" + money(costA) + ")");
  }
  if($("upgradeToStoreBtn")){
    var costB = (s && s.roleKey === "general_store") ? COST_STALL_TO_STOREFRONT : 480;
    setText("upgradeToStoreBtn", "Upgrade: Stall → Storefront (" + money(costB) + ")");
  }
  if($("hireHelpBtn")) setText("hireHelpBtn", "Hire steady help (" + money(260) + ")");
  if($("unlockNewsBtn")) setText("unlockNewsBtn", "Support the Town Gazette (" + money(200) + ")");
}

/* -----------------------------
   ASCII rendering (kept)
-------------------------------- */
function renderAscii(){
  if(!s) return;

  var artBlock = $("ascii_display");
  var caption = $("ascii_caption");
  if(!artBlock || !caption) return;

  var roleSet = (typeof ASCII_ART !== "undefined") ? ASCII_ART[s.roleKey] : null;
  var art = roleSet ? roleSet[s.stage] : null;

  if(art){
    artBlock.textContent = art;
    show("ascii_display");
  } else {
    artBlock.textContent = "";
    hide("ascii_display");
  }

  if(s.roleKey === "general_store") caption.textContent = "Make smart prices. Keep stock. Grow slowly.";
  else if(s.roleKey === "blacksmith") caption.textContent = "Fewer jobs, heavier rewards. Mistakes cost.";
  else if(s.roleKey === "boarding_house") caption.textContent = "Guests talk. Reputation matters fast.";
  else caption.textContent = "";
}

function renderTownFeatures(){
  if(!s) return;

  hide("town_features");
  hide("ascii_gazette");
  hide("ascii_bank");

  var town = (typeof TOWN_ASCII !== "undefined") ? TOWN_ASCII : null;
  if(!town) return;

  if(s.unlocked.newspaperOffer && town.gazette && $("ascii_gazette")){
    $("ascii_gazette").textContent = town.gazette;
    show("ascii_gazette");
    show("town_features");
  }

  if(s.unlocked.bank && town.bank && $("ascii_bank")){
    $("ascii_bank").textContent = town.bank;
    show("ascii_bank");
    show("town_features");
  }
}

/* -----------------------------
   Loop
-------------------------------- */
function startLoop(){
  stopLoop();
  tickHandle = setInterval(tick, 1000);
}

function stopLoop(){
  if(tickHandle) clearInterval(tickHandle);
  tickHandle = null;
}

function tick(){
  if(!s) return;

  s.seconds += 1;

  // passive income (General Store = 0)
  s.money += incomePerSecond();

  // demand drift (kept)
  if(s.seconds % 10 === 0){
    var drift = (s.reputation - 50) / 5000;
    s.demand = clamp(s.demand + drift, 0.85, 1.20);
  }

  // ongoing interest if bank exists
  if(s.unlocked.bank && s.debt > 0 && s.seconds % INTEREST_EVERY_SECONDS === 0){
    var interest = Math.max(1, Math.floor(s.debt * INTEREST_RATE));
    s.debt += interest;
    log("Bank interest increased your debt by " + money(interest) + ".");
    if(s.debt >= 350){
      setNotice("WARNING: Your debt is getting dangerous.", "red");
    }
  }

  checkUnlocks();

  if(s.seconds % 15 === 0) saveGame(true);

  render();
}

/* -----------------------------
   Unlocks (General Store tuned harder)
-------------------------------- */
function checkUnlocks(){
  // Always show main buttons after start
  show("serveBtn");
  show("goodDeedBtn");
  show("log");

  // Restock exists; only show for general store once item selected
  ensureRestockButton();
  if(s.roleKey === "general_store" && s.gs.itemName){
    show("restockBtn");
  } else {
    hide("restockBtn");
  }

  // Hide advanced actions until later
  hide("advertiseBtn");
  hide("loanBtn");
  hide("repayBtn");
  hide("unlockNewsBtn");

  // UPGRADES: General Store uses realistic costs and tougher gates
  if(s.roleKey === "general_store"){
    // Unlock stall upgrade after consistent selling + some money
    if(!s.unlocked.stall && (s.served >= 60 && s.money >= (COST_CART_TO_STALL * 0.40))){
      s.unlocked.stall = true;
      show("upgrade_block");
      show("upgradeToStallBtn");
      log("A market permit might be possible… if you can afford it.");
      setNotice("NEW UPGRADE AVAILABLE: Cart → Market Stall", "yellow");
    }

    // Unlock storefront after lots of sales + rep + money
    if(!s.unlocked.storefront && (s.served >= 220 && s.reputation >= 25 && s.money >= (COST_STALL_TO_STOREFRONT * 0.25))){
      s.unlocked.storefront = true;
      show("upgrade_block");
      show("upgradeToStoreBtn");
      log("A vacant storefront exists… but it’s expensive.");
      setNotice("NEW UPGRADE AVAILABLE: Stall → Storefront", "yellow");
    }

    // Bank unlock later for General Store (you can tune)
    if(!s.unlocked.bank && (s.stage >= 1 && s.money >= 500)){
      s.unlocked.bank = true;
      log("The bank clerk finally takes you seriously.");
      setNotice("NEW RISK: Bank loans unlocked. Debt gains interest.", "red");
    }

    if(s.unlocked.bank){
      show("loanBtn");
      show("repayBtn");
    }

    // Gazette offer later (keep for later)
    if(!s.unlocked.newspaperOffer && (s.stage >= 1 && s.reputation >= 15)){
      s.unlocked.newspaperOffer = true;
      show("upgrade_block");
      log("The Town Gazette offers a feature… for a price.");
      setNotice("NEW OPTION: Support the Town Gazette", "yellow");
    }

    if(s.unlocked.newspaperOffer && !s.gazetteSupported){
      show("upgrade_block");
      show("unlockNewsBtn");
    }

    if(s.gazetteSupported){
      show("advertiseBtn");
    }

    return;
  }

  // OTHER ROLES: keep your older pacing (unchanged)
  if(!s.unlocked.stall && (s.money >= 120 || s.served >= 10)){
    s.unlocked.stall = true;
    show("upgrade_block");
    show("upgradeToStallBtn");
  }
  if(!s.unlocked.storefront && (s.money >= 450 || s.reputation >= 75)){
    s.unlocked.storefront = true;
    show("upgrade_block");
    show("upgradeToStoreBtn");
  }
  if(!s.unlocked.bank && (s.money >= 220 || s.stage >= 1)){
    s.unlocked.bank = true;
    show("loanBtn");
    show("repayBtn");
  }
}

/* =========================
   GENERAL STORE SALE LOGIC
   ========================= */

function gsItemDef(){
  for(var i=0;i<GS_ITEMS.length;i++){
    if(GS_ITEMS[i].key === s.gs.itemKey) return GS_ITEMS[i];
  }
  return null;
}

function gsCustomerEvent(){
  // simple roleplay prompt event
  var prompts = [
    {
      customer: "A mother says her child is sick and needs supplies.",
      question: "What do you say?\n1) \"Rules are rules, pay full price.\"\n2) \"I can do a small discount, just this once.\"\n3) \"Get out of my way.\"",
      correct: "2",
      repGood: 3,
      repBad: -2
    },
    {
      customer: "A miner complains your price feels unfair.",
      question: "How do you respond?\n1) Explain your costs calmly\n2) Laugh at him\n3) Threaten to raise prices more",
      correct: "1",
      repGood: 2,
      repBad: -2
    },
    {
      customer: "A regular asks if you can hold an item until tomorrow.",
      question: "Your answer?\n1) \"Sure, I’ll set it aside.\" \n2) \"No, first come first serve.\" \n3) \"Pay double or no.\"",
      correct: "1",
      repGood: 2,
      repBad: -1
    }
  ];

  var ev = prompts[Math.floor(Math.random() * prompts.length)];
  var ans = prompt(ev.customer + "\n\n" + ev.question, ev.correct);

  if(ans === null) ans = "";
  ans = ans.trim();

  if(ans === ev.correct){
    s.reputation = clamp(s.reputation + ev.repGood, -100, 100);
    log("You handled it well. +" + ev.repGood + " reputation.");
    setNotice("Good talk: reputation increased.", "yellow");
  } else {
    s.reputation = clamp(s.reputation + ev.repBad, -100, 100);
    log("That went poorly. " + ev.repBad + " reputation.");
    setNotice("Bad talk: reputation dropped.", "red");
  }
}

/* -----------------------------
   Actions
-------------------------------- */

function serveCustomer(){
  // General Store: selling inventory
  if(s.roleKey === "general_store"){
    if(!s.gs.itemName){
      setNotice("Pick an item to sell first.", "red");
      return;
    }

    if(s.gs.stock <= 0){
      log("You’re out of stock. Restock before selling.");
      setNotice("Out of stock.", "red");
      return;
    }

    var def = gsItemDef();
    var price = s.gs.sellPrice;
    var discount = s.gs.nextDiscount || 0;

    // apply discount for this sale only
    var finalPrice = Math.max(0, price - discount);
    s.gs.nextDiscount = 0;

    s.served += 1;
    s.gs.stock -= 1;

    // Money gained (this is your sale revenue)
    s.money += finalPrice;

    // Determine rep outcome based on pricing
    var repDelta = 0;

    if(def){
      if(price >= def.highPrice){
        // Too expensive => upset no matter what
        repDelta = -2;
        log("Customer upset: price felt too high.");
        setNotice("Too expensive. Customers will complain.", "red");
      } else if(price <= def.lowPrice){
        // Too cheap => high rep, but you may not afford restocks
        repDelta = +3;
        log("Customer thrilled: bargain pricing.");
        setNotice("Very cheap prices: great rep, weak growth.", "yellow");
      } else if(price >= def.fairMin && price <= def.fairMax){
        // fair band => mostly stable, but sometimes events
        repDelta = (Math.random() < 0.55) ? +1 : 0;

        // Random event popup (talk your way into/ out of rep)
        if(Math.random() < GS_EVENT_CHANCE){
          gsCustomerEvent();
          // customer event already changes rep and logs
          render(); saveGame(true);
          return;
        }
      } else {
        // in-between "not great" range (slightly high but not guaranteed anger)
        repDelta = (Math.random() < 0.60) ? -1 : 0;
      }
    }

    if(repDelta !== 0){
      s.reputation = clamp(s.reputation + repDelta, -100, 100);
      if(repDelta > 0) log("Reputation improved. +" + repDelta + " rep.");
      else log("Reputation dropped. " + repDelta + " rep.");
    } else {
      log("Sale completed. No major reaction.");
    }

    // Basic feedback about discount
    if(discount > 0){
      log("You discounted the sale by " + money(discount) + ".");
    }

    // Warn player if restocking is hard
    if(def && s.money < def.unitCost * GS_RESTOCK_DEFAULT_QTY && s.gs.stock <= 3){
      setNotice("Warning: you’re low on stock and cash. Consider raising price or saving for restock.", "red");
    }

    render();
    saveGame(true);
    return;
  }

  // Other roles: keep old serve behavior
  var role = ROLES[s.roleKey];
  var goodChance = clamp(0.25 + (s.reputation/100)*0.55 + (s.stage*0.05), 0.10, 0.90);
  var isGood = (Math.random() < goodChance);
  s.served += 1;

  if(isGood){
    s.goodServed += 1;
    var payout = (role.serveMoney + s.stage*3) * (0.85 + (s.reputation/100)*0.5);
    s.money += payout;
    var repGain = Math.floor(role.serveRep + s.repGainBonus);
    s.reputation = clamp(s.reputation + repGain, 0, 100);
    log("Good customer! +" + money(payout) + " and +" + repGain + " reputation.");
  } else {
    s.badServed += 1;
    var loss = Math.max(2, Math.floor(role.serveMoney * 0.6));
    s.money = Math.max(0, s.money - loss);
    var repHit = Math.max(1, 4 - Math.floor(s.stage/2));
    s.reputation = clamp(s.reputation - repHit, 0, 100);
    log("Customer complaint… -" + money(loss) + " and -" + repHit + " reputation.");
    setNotice("Careful: complaints hurt reputation.", "red");
  }

  render();
  saveGame(true);
}

function offerDiscount(){
  if(s.roleKey !== "general_store"){
    // For now, other roles just do the old rep bump (kept simple)
    var cost = 5;
    if(s.money < cost){ log("Not enough money."); return; }
    s.money -= cost;
    s.reputation = clamp(s.reputation + 2, 0, 100);
    log("You offered a discount. -" + money(cost) + ", +2 reputation.");
    render(); saveGame(true);
    return;
  }

  if(!s.gs.itemName){
    setNotice("Pick an item to sell first.", "red");
    return;
  }

  var raw = prompt("How much discount (in dollars) should apply to your NEXT sale?\nExample: 1", "1");
  if(raw === null) return;

  var d = parseInt(raw, 10);
  if(isNaN(d) || d <= 0){
    alert("Type a whole number like 1 or 2.");
    return;
  }

  // Don't allow discount larger than the sell price
  d = Math.min(d, s.gs.sellPrice);

  s.gs.nextDiscount = d;

  // Reputation gain: small but scales a little with discount
  var repGain = clamp(1 + Math.floor(d / 2), 1, 4);
  s.reputation = clamp(s.reputation + repGain, -100, 100);

  log("You plan a discount of " + money(d) + " on the next sale. +" + repGain + " reputation.");
  setNotice("Discount set for next sale.", "yellow");
  render();
  saveGame(true);
}

// Backward compatible hook if your index still calls doGoodDeed()
function doGoodDeed(){ offerDiscount(); }

function restockInventory(){
  if(!s || s.roleKey !== "general_store") return;
  if(!s.gs.itemName){
    setNotice("Pick an item to sell first.", "red");
    return;
  }

  var raw = prompt(
    "How many " + s.gs.itemName + " do you want to restock?\n" +
    "Cost: " + money(s.gs.unitCost) + " each",
    String(GS_RESTOCK_DEFAULT_QTY)
  );
  if(raw === null) return;

  var qty = parseInt(raw, 10);
  if(isNaN(qty) || qty <= 0){
    alert("Type a whole number like 10.");
    return;
  }

  var total = qty * s.gs.unitCost;
  if(s.money < total){
    log("Not enough money to restock that many. Need " + money(total) + ".");
    setNotice("Not enough cash to restock.", "red");
    return;
  }

  s.money -= total;
  s.gs.stock += qty;

  log("Restocked +" + qty + " " + s.gs.itemName + " for " + money(total) + ".");
  setNotice("Stock refilled.", "yellow");
  render();
  saveGame(true);
}

function advertise(){
  if(!s.gazetteSupported){
    log("You need Gazette support before you can advertise.");
    setNotice("Support the Gazette first.", "red");
    return;
  }

  var cost = 30 + (s.stage * 10);
  if(s.money < cost){
    log("Advertising costs money. You don't have enough.");
    setNotice("Not enough money to advertise.", "red");
    return;
  }

  s.money -= cost;
  s.demand = clamp(s.demand + 0.06, 0.85, 1.20);

  log("You ran an advertisement in the Gazette. Demand increased a bit.");
  setNotice("Advertising worked.", "yellow");
  render();
  saveGame(true);
}

/* -----------------------------
   Bank actions (kept)
-------------------------------- */
function takeLoan(){
  if(!s.unlocked.bank){
    log("No bank available yet.");
    return;
  }

  s.money += LOAN_CASH_AMOUNT;
  s.debt += LOAN_DEBT_AMOUNT;

  log("You took a bank loan: +" + money(LOAN_CASH_AMOUNT) + ". Debt increased by " + money(LOAN_DEBT_AMOUNT) + ".");
  setNotice("Loan taken. Debt grows with interest.", "red");
  render();
  saveGame(true);
}

function repayLoan(){
  if(s.debt <= 0){
    log("You have no debt.");
    setNotice("No debt to repay.", "yellow");
    return;
  }

  var pay = Math.min(REPAY_PER_CLICK, s.debt);
  if(s.money < pay){
    log("You don't have enough money to repay right now.");
    setNotice("Not enough money to repay debt.", "red");
    return;
  }

  s.money -= pay;
  s.debt -= pay;

  log("You repaid " + money(pay) + " of your debt.");
  setNotice("Debt reduced.", "yellow");
  render();
  saveGame(true);
}

/* -----------------------------
   Upgrades
-------------------------------- */
function buyUpgrade(which){
  // General Store realistic costs
  if(s.roleKey === "general_store"){
    if(which === "stall"){
      var cost = COST_CART_TO_STALL;
      if(s.money < cost){ log("You need " + money(cost) + " to upgrade."); return; }
      if(s.stage >= 1){ log("You already have a stall or better."); return; }

      s.money -= cost;
      s.stage = 1;

      log("Upgrade complete: Cart → Market Stall.");
      setNotice("Upgrade purchased.", "yellow");
      render(); saveGame(true);
      return;
    }

    if(which === "storefront"){
      var cost2 = COST_STALL_TO_STOREFRONT;
      if(s.money < cost2){ log("You need " + money(cost2) + " to upgrade."); return; }
      if(s.stage >= 2){ log("You already have a storefront."); return; }
      if(s.stage < 1){ log("You need the stall first."); return; }

      s.money -= cost2;
      s.stage = 2;

      log("Upgrade complete: Stall → Storefront.");
      setNotice("Upgrade purchased.", "yellow");
      render(); saveGame(true);
      return;
    }

    if(which === "newspaper"){
      var costG = 200;
      if(!s.unlocked.newspaperOffer){ log("You haven't met the Gazette yet."); return; }
      if(s.gazetteSupported){ log("The Gazette already supports you."); return; }
      if(s.money < costG){ log("You need " + money(costG) + " to support the Gazette."); return; }

      s.money -= costG;
      s.gazetteSupported = true;
      s.reputation = clamp(s.reputation + 3, -100, 100);

      log("The Gazette features your business. Advertising unlocked.");
      setNotice("Unlocked: advertising.", "yellow");
      render(); saveGame(true);
      return;
    }

    return;
  }

  // Other roles: keep your older prices
  if(which === "stall"){
    var costA = 120;
    if(s.money < costA){ log("You need " + money(costA) + " to upgrade."); return; }
    if(s.stage >= 1){ log("You already upgraded."); return; }
    s.money -= costA; s.stage = 1; s.incomeBonus += 1;
    log("Upgrade complete: Stage 1 → Stage 2.");
    render(); saveGame(true); return;
  }

  if(which === "storefront"){
    var costB = 480;
    if(s.money < costB){ log("You need " + money(costB) + " to upgrade."); return; }
    if(s.stage >= 2){ log("You already have the top upgrade."); return; }
    if(s.stage < 1){ log("You need the first upgrade first."); return; }
    s.money -= costB; s.stage = 2; s.incomeBonus += 3;
    log("Upgrade complete: Stage 2 → Stage 3.");
    render(); saveGame(true); return;
  }
}

/* -----------------------------
   Render
-------------------------------- */
function render(){
  if(!s) return;

  updateButtonLabels();

  var role = ROLES[s.roleKey];

  var extra = "";
  if(s.roleKey === "general_store" && s.gs.itemName){
    extra =
      " <span class='muted'>(Item: " + s.gs.itemName +
      " | Stock: " + s.gs.stock +
      " | Price: " + money(s.gs.sellPrice) + ")</span>";
  }

  setHTML("role_line", "<b>Role:</b> " + role.name);
  setHTML("money_line", "<b>Money:</b> " + money(s.money) +
    " <span class='muted'>(Debt: " + money(s.debt) + ")</span>" + extra);

  setHTML("rep_line", "<b>Reputation:</b> " + s.reputation);
  setHTML("stage_line", "<b>Business:</b> " + stageName());

  // General store: show 0 income per second clearly
  setHTML("income_line", "<b>Income:</b> " + incomePerSecond().toFixed(1) +
    " per second <span class='muted'>(Demand x" + s.demand.toFixed(2) + ")</span>");

  var baseStory = "";
  if(s.roleKey === "general_store"){
    if(!s.gs.itemName){
      baseStory = "You’re at a cart with cash, but nothing to sell yet.";
    } else if(s.stage === 0){
      baseStory = "One cart. One item. Your prices decide your future.";
    } else if(s.stage === 1){
      baseStory = "A stall means better foot traffic, but your costs are higher too.";
    } else {
      baseStory = "A storefront makes you legitimate. Now the town expects consistency.";
    }
  } else {
    // old story style for other roles
    if(s.seconds < 8) baseStory = role.intro;
    else baseStory = "Keep working to grow.";
  }

  var noticeHtml = "";
  if(notice.text){
    if(notice.type === "yellow") noticeHtml = "<span class='notice-yellow'>" + notice.text + "</span><br/><br/>";
    else if(notice.type === "red") noticeHtml = "<span class='notice-red'>" + notice.text + "</span><br/><br/>";
    else noticeHtml = notice.text + "<br/><br/>";
  }

  setHTML("story_line", noticeHtml + baseStory);

  show("role_line");
  show("money_line");
  show("rep_line");
  show("stage_line");
  show("income_line");
  show("story_line");
  show("serveBtn");
  show("goodDeedBtn");
  show("log");

  // upgrades block visibility
  if(s.unlocked.stall || s.unlocked.storefront || s.unlocked.newspaperOffer || s.stage >= 1){
    show("upgrade_block");
  } else {
    hide("upgrade_block");
  }

  if(s.unlocked.stall && s.stage === 0) show("upgradeToStallBtn"); else hide("upgradeToStallBtn");
  if(s.unlocked.storefront && s.stage === 1) show("upgradeToStoreBtn"); else hide("upgradeToStoreBtn");

  // Gazette button only until supported
  if(s.unlocked.newspaperOffer && !s.gazetteSupported) show("unlockNewsBtn"); else hide("unlockNewsBtn");

  renderAscii();
  renderTownFeatures();
  renderLog();
}

/* -----------------------------
   Start / Save / Load / Restart
-------------------------------- */
function startGame(){
  var roleKey = $("roleSelect") ? $("roleSelect").value : "general_store";
  s = newState(roleKey);

  hide("setup_block");
  resetUIBeforeStart();
  ensureRestockButton();

  // Starter buttons
  show("serveBtn");
  show("goodDeedBtn");

  // General Store: set new starting rules + popups
  if(roleKey === "general_store"){
    s.money = GS_START_MONEY;
    s.reputation = GS_START_REP;
    s.stage = 0;
    s.demand = 1.0;

    setNotice("You opened with a cart. Choose what you’ll sell.", "yellow");
    render();

    // choose item + price
    var ok1 = gsPickItemFlow();
    if(!ok1){
      setNotice("Item selection cancelled. Pick an item when you're ready.", "red");
      render();
      return;
    }

    var ok2 = gsSetPriceFlow();
    if(!ok2){
      setNotice("Price selection cancelled. Set your price when you're ready.", "red");
      render();
      return;
    }

    setNotice("Ready. Sell your first item.", "yellow");
    log("Your cart is set. Stock: " + s.gs.stock + " " + s.gs.itemName + ".");
  } else {
    setNotice("Tip: Serve customers to earn money + reputation.", "yellow");
    log("You begin. The town watches.");
  }

  render();
  startLoop();
  saveGame(true);
}

function saveGame(silent){
  if(!s) return;
  try{
    localStorage.setItem(SAVE_KEY, JSON.stringify(s));
    if(!silent){
      setText("saveStatus", "Saved.");
      setTimeout(function(){ setText("saveStatus", ""); }, 1200);
    }
  } catch(e){
    setText("saveStatus", "Save failed (storage blocked).");
  }
}

function loadGame(){
  try{
    var raw = localStorage.getItem(SAVE_KEY);
    if(!raw){ alert("No save found on this device."); return; }
    s = JSON.parse(raw);

    hide("setup_block");
    resetUIBeforeStart();
    ensureRestockButton();

    setNotice("Loaded save.", "yellow");
    render();
    log("Loaded save.");
    startLoop();
  } catch(e){
    alert("Load failed.");
  }
}

function restartGame(){
  if(!confirm("Restart game? This clears your save.")) return;
  localStorage.removeItem(SAVE_KEY);
  stopLoop();
  location.reload();
}

/* -----------------------------
   Init
-------------------------------- */
(function init(){
  resetUIBeforeStart();
  ensureRestockButton();
  updateButtonLabels();

  var raw = localStorage.getItem(SAVE_KEY);
  if(raw) setText("saveStatus", "Save found on this device.");
})();

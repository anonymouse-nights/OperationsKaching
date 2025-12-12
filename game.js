/* =========================================================
   TOWN TRADE - game.js
   Uses:
   - ascii.js must load FIRST and define:
       var ASCII_ART = { roleKey: {0:"...",1:"...",2:"..."} }
       var TOWN_ASCII = { bank:"...", gazette:"..." }
   HTML must include:
     <pre id="ascii_display" class="hidden"></pre>
     <span id="ascii_caption" class="tiny"></span>
     <div id="town_features" class="hidden">
       <pre id="ascii_bank" class="hidden"></pre>
       <pre id="ascii_gazette" class="hidden"></pre>
     </div>
   ========================================================= */

/* -------------------------
   1) GAME CONSTANTS / DATA
   ------------------------- */

var SAVE_KEY = "townTrade_cb_style_v2";

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

// Stage progression (still used for game logic + display)
var STAGES = ["Stage 1", "Stage 2", "Stage 3"];

// The live save-state object
var s = null;

// Tick loop
var tickHandle = null;
var lastTick = null;

// Highlight notice shown above the story
var notice = { text: "", type: "" }; // type: "yellow" | "red" | ""

/* -------------------------
   2) STATE FACTORY
   ------------------------- */

function newState(roleKey){
  return {
    roleKey: roleKey,

    money: 50,
    reputation: 60,
    stage: 0,

    debt: 0,

    // modifiers
    incomeBonus: 0,
    repGainBonus: 0,
    demand: 1.0,

    // stats
    seconds: 0,
    served: 0,
    goodServed: 0,
    badServed: 0,

    // unlock flags
    unlocked: {
      stall: false,       // stage upgrade 0->1 unlocked
      storefront: false,  // stage upgrade 1->2 unlocked
      newspaper: false,
      bank: false
    },

    logLines: []
  };
}

/* -------------------------
   3) DOM / UI HELPERS
   ------------------------- */

function $(id){ return document.getElementById(id); }

function money(n){
  n = Math.floor(n);
  return "$" + n.toString();
}

function clamp(n, a, b){
  if(n < a) return a;
  if(n > b) return b;
  return n;
}

function show(id){
  var el = $(id);
  if(!el) return;
  el.className = el.className.replace("hidden", "").trim();
}

function hide(id){
  var el = $(id);
  if(!el) return;
  if(el.className.indexOf("hidden") === -1) el.className += " hidden";
}

function log(msg){
  var ts = new Date().toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});
  s.logLines.unshift("[" + ts + "] " + msg);
  if(s.logLines.length > 18) s.logLines.pop();
  renderLog();
}

function renderLog(){
  var el = $("log");
  if(!el) return;
  el.textContent = s.logLines.join("\n");
}

function setNotice(text, type){
  notice.text = text || "";
  notice.type = type || "";
}

/* -------------------------
   4) ASCII RENDERING
   ------------------------- */

function renderAscii(){
  var artBlock = $("ascii_display");
  var caption = $("ascii_caption");
  if(!artBlock || !caption) return;
  if(!s) return;

  // Pull role art from ASCII_ART (from ascii.js)
  var roleSet = (typeof ASCII_ART !== "undefined") ? ASCII_ART[s.roleKey] : null;
  var art = roleSet ? roleSet[s.stage] : null;

  if(art){
    artBlock.textContent = art;
    show("ascii_display");
  } else {
    // fallback if missing
    artBlock.textContent = "";
    hide("ascii_display");
  }

  // Simple captions (you can customize these anytime)
  if(s.roleKey === "general_store") caption.textContent = "You grow by keeping steady customers and trust.";
  else if(s.roleKey === "blacksmith") caption.textContent = "Fewer jobs, heavier rewards. Mistakes cost.";
  else if(s.roleKey === "boarding_house") caption.textContent = "Guests talk. Reputation matters fast.";
  else caption.textContent = "";
}

function renderTownFeatures(){
  if(!s) return;

  hide("town_features");
  hide("ascii_bank");
  hide("ascii_gazette");

  // Pull town art from TOWN_ASCII (from ascii.js)
  var town = (typeof TOWN_ASCII !== "undefined") ? TOWN_ASCII : null;

  if(s.unlocked.newspaper && town && town.gazette){
    $("ascii_gazette").textContent = town.gazette;
    show("ascii_gazette");
    show("town_features");
  }

  if(s.unlocked.bank && town && town.bank){
    $("ascii_bank").textContent = town.bank;
    show("ascii_bank");
    show("town_features");
  }
}

/* -------------------------
   5) CORE MECHANICS / LOOP
   ------------------------- */

function incomePerSecond(){
  var role = ROLES[s.roleKey];
  var stageBonus = s.stage * 0.8;
  return (role.baseIncome + stageBonus + s.incomeBonus) * s.demand;
}

function startLoop(){
  stopLoop();
  lastTick = new Date().getTime();
  tickHandle = setInterval(tick, 1000);
}

function stopLoop(){
  if(tickHandle) clearInterval(tickHandle);
  tickHandle = null;
}

function tick(){
  if(!s) return;

  s.seconds += 1;

  // Passive earnings
  s.money += incomePerSecond();

  // Demand drifts with reputation
  if(s.seconds % 10 === 0){
    var drift = (s.reputation - 50) / 5000;
    s.demand = clamp(s.demand + drift, 0.85, 1.20);
  }

  // Bank interest
  if(s.unlocked.bank && s.debt > 0 && s.seconds % 12 === 0){
    var interest = Math.max(1, Math.floor(s.debt * 0.02));
    s.debt += interest;
    log("Bank interest increased your debt by " + money(interest) + ".");
    if(s.debt >= 350){
      setNotice("WARNING: Your debt is getting dangerous.", "red");
    }
  }

  checkUnlocks();

  // Autosave
  if(s.seconds % 15 === 0) saveGame(true);

  render();
}

/* -------------------------
   6) UNLOCKS
   ------------------------- */

function checkUnlocks(){
  // Stage 1 upgrade becomes available
  if(!s.unlocked.stall && (s.money >= 120 || s.served >= 10)){
    s.unlocked.stall = true;
    show("upgrade_block");
    show("upgradeToStallBtn");
    log("You spot a better opportunity to expand.");
    setNotice("NEW UPGRADE AVAILABLE: Stage 1 → Stage 2", "yellow");
  }

  // Stage 2 upgrade becomes available
  if(!s.unlocked.storefront && (s.money >= 450 || s.reputation >= 75)){
    s.unlocked.storefront = true;
    show("upgradeToStoreBtn");
    log("A bigger expansion is possible now.");
    setNotice("NEW UPGRADE AVAILABLE: Stage 2 → Stage 3", "yellow");
  }

  // Gazette unlock
  if(!s.unlocked.newspaper && (s.reputation >= 70 || s.goodServed >= 8)){
    s.unlocked.newspaper = true;
    show("unlockNewsBtn");
    log("The Town Gazette offers to feature you (for a price).");
    setNotice("NEW OPTION: Support the Town Gazette (advertising)", "yellow");
  }

  // Bank unlock
  if(!s.unlocked.bank && (s.money >= 220 || s.stage >= 1)){
    s.unlocked.bank = true;
    show("loanBtn");
    show("repayBtn");
    log("The bank clerk offers you a loan. (Be careful.)");
    setNotice("NEW RISK: Bank loans unlocked. Debt gains interest.", "red");
  }

  // Core buttons appear after start
  show("serveBtn");
  show("goodDeedBtn");
  show("log");

  // Advertise only after newspaper supported
  if(s.unlocked.newspaper) show("advertiseBtn");

  // Show/hide upgrade area
  if(s.unlocked.stall || s.unlocked.storefront || s.stage >= 1) show("upgrade_block");
}

/* -------------------------
   7) ACTIONS (BUTTONS)
   ------------------------- */

function serveCustomer(){
  var role = ROLES[s.roleKey];

  var goodChance = clamp(0.25 + (s.reputation/100)*0.55 + (s.stage*0.05), 0.10, 0.90);
  var isGood = (Math.random() < goodChance);

  s.served += 1;

  if(isGood){
    s.goodServed += 1;

    var payout = (role.serveMoney + s.stage*3) * (0.85 + (s.reputation/100)*0.5);
    s.money += payout;

    var repGain = Math.floor((role.serveRep + s.repGainBonus) * 1.0);
    s.reputation = clamp(s.reputation + repGain, 0, 100);

    log("Good customer! +" + money(payout) + " and +" + repGain + " reputation.");
    if(repGain >= 3) setNotice("Nice! Your reputation is climbing.", "yellow");
  } else {
    s.badServed += 1;

    var loss = Math.max(2, Math.floor(role.serveMoney * 0.6));
    s.money = Math.max(0, s.money - loss);

    var repHit = Math.max(1, 4 - Math.floor(s.stage/2));
    s.reputation = clamp(s.reputation - repHit, 0, 100);

    log("Customer complaint… -" + money(loss) + " and -" + repHit + " reputation.");
    setNotice("Careful: complaints hurt reputation (and long-term demand).", "red");
  }

  render();
  saveGame(true);
}

function doGoodDeed(){
  var cost = 12 + (s.stage*4);
  if(s.money < cost){
    log("You want to help, but you don't have enough cash right now.");
    setNotice("Not enough money for that right now.", "red");
    return;
  }

  s.money -= cost;

  var rep = 4 + Math.floor(s.stage/2);
  s.reputation = clamp(s.reputation + rep, 0, 100);

  log("You helped a customer fairly. -" + money(cost) + ", +" + rep + " reputation.");
  setNotice("Good deed completed: reputation increased.", "yellow");
  render();
  saveGame(true);
}

function advertise(){
  var cost = 30 + (s.stage*10);
  if(s.money < cost){
    log("Advertising costs money. You don't have enough.");
    setNotice("Not enough money to advertise.", "red");
    return;
  }

  s.money -= cost;
  s.demand = clamp(s.demand + 0.06, 0.85, 1.20);

  log("You ran an advertisement in the Gazette. Demand increased a bit.");
  setNotice("Advertising worked: demand increased.", "yellow");
  render();
  saveGame(true);
}

function takeLoan(){
  if(!s.unlocked.bank){
    log("No bank available yet.");
    return;
  }

  var amount = 120;
  s.money += amount;
  s.debt += amount;

  log("You took a bank loan: +" + money(amount) + ". (Debt increases with interest.)");
  setNotice("Loan taken: remember debt grows with interest.", "red");
  render();
  saveGame(true);
}

function repayLoan(){
  if(s.debt <= 0){
    log("You have no debt.");
    setNotice("No debt to repay.", "yellow");
    return;
  }

  var pay = Math.min(80, s.debt);
  if(s.money < pay){
    log("You don't have enough money to repay right now.");
    setNotice("Not enough money to repay debt.", "red");
    return;
  }

  s.money -= pay;
  s.debt -= pay;

  log("You repaid " + money(pay) + " of your debt.");
  setNotice("Debt reduced. Nice.", "yellow");
  render();
  saveGame(true);
}

function buyUpgrade(which){
  // Stage 0 -> Stage 1
  if(which === "stall"){
    var cost = 120;
    if(s.money < cost){ log("You need " + money(cost) + " to upgrade."); setNotice("Need " + money(cost) + " to upgrade.", "red"); return; }
    if(s.stage >= 1){ log("You already upgraded."); return; }

    s.money -= cost;
    s.stage = 1;
    s.incomeBonus += 1;

    log("Upgrade complete: Stage 1 → Stage 2. Income increased.");
    setNotice("Upgrade purchased: Stage 2 unlocked.", "yellow");
    render();
    saveGame(true);
    return;
  }

  // Stage 1 -> Stage 2
  if(which === "storefront"){
    var cost2 = 480;
    if(s.money < cost2){ log("You need " + money(cost2) + " to upgrade."); setNotice("Need " + money(cost2) + " to upgrade.", "red"); return; }
    if(s.stage >= 2){ log("You already have the top upgrade."); return; }
    if(s.stage < 1){ log("You need the first upgrade first."); setNotice("You need the first upgrade before this.", "red"); return; }

    s.money -= cost2;
    s.stage = 2;
    s.incomeBonus += 3;

    log("Upgrade complete: Stage 2 → Stage 3. Steady income jumped.");
    setNotice("Upgrade purchased: Stage 3 unlocked.", "yellow");
    render();
    saveGame(true);
    return;
  }

  // Hire help
  if(which === "helper"){
    var cost3 = 260;
    if(s.money < cost3){ log("You need " + money(cost3) + " to hire help."); setNotice("Need " + money(cost3) + " to hire help.", "red"); return; }

    s.money -= cost3;
    s.incomeBonus += 2;
    s.repGainBonus += 1;

    log("You hired steady help. Income +2/sec and service improves.");
    setNotice("Upgrade purchased: Steady help hired.", "yellow");
    render();
    saveGame(true);
    return;
  }

  // Support Gazette (enables advertising + rep boost)
  if(which === "newspaper"){
    var cost4 = 200;
    if(s.money < cost4){ log("You need " + money(cost4) + " to support the Gazette."); setNotice("Need " + money(cost4) + " to support the Gazette.", "red"); return; }

    s.money -= cost4;
    s.unlocked.newspaper = true;
    s.reputation = clamp(s.reputation + 6, 0, 100);

    log("The Gazette features your business. Advertising unlocked.");
    setNotice("Unlocked: advertising (Gazette).", "yellow");
    render();
    saveGame(true);
    return;
  }
}

/* -------------------------
   8) RENDERING (UI UPDATE)
   ------------------------- */

function render(){
  if(!s) return;

  var role = ROLES[s.roleKey];

  $("role_line").innerHTML = "<b>Role:</b> " + role.name;
  $("money_line").innerHTML =
    "<b>Money:</b> " + money(s.money) +
    " <span class='muted'>(Debt: " + money(s.debt) + ")</span>";

  $("rep_line").innerHTML = "<b>Reputation:</b> " + s.reputation + " / 100";

  // Keep “Business” wording generic since each role differs
  $("stage_line").innerHTML = "<b>Progress:</b> " + STAGES[s.stage];

  $("income_line").innerHTML =
    "<b>Income:</b> " + incomePerSecond().toFixed(1) + " per second " +
    "<span class='muted'>(Demand x" + s.demand.toFixed(2) + ")</span>";

  // Base story
  var baseStory = "";
  if(s.seconds < 8){
    baseStory = role.intro;
  } else if(s.stage === 0){
    baseStory = "The town is small, but every honest sale matters. Keep serving customers.";
  } else if(s.stage === 1){
    baseStory = "Your name is spreading. Reputation will shape your future here.";
  } else {
    baseStory = "You’ve become a real part of the town. Bigger decisions are coming.";
  }

  // Notice line (yellow/red)
  var noticeHtml = "";
  if(notice.text){
    if(notice.type === "yellow") noticeHtml = "<span class='notice-yellow'>" + notice.text + "</span><br/><br/>";
    else if(notice.type === "red") noticeHtml = "<span class='notice-red'>" + notice.text + "</span><br/><br/>";
    else noticeHtml = notice.text + "<br/><br/>";
  }

  $("story_line").innerHTML = noticeHtml + baseStory;

  // Show core lines/buttons
  show("role_line");
  show("money_line");
  show("rep_line");
  show("stage_line");
  show("income_line");
  show("story_line");
  show("serveBtn");
  show("goodDeedBtn");
  show("log");

  // Upgrade buttons visibility rules
  if(s.unlocked.stall) show("upgrade_block");
  if(s.unlocked.stall && s.stage === 0) show("upgradeToStallBtn");
  else hide("upgradeToStallBtn");

  if(s.unlocked.storefront && s.stage === 1) show("upgradeToStoreBtn");
  else hide("upgradeToStoreBtn");

  if(s.stage >= 1) show("hireHelpBtn");
  else hide("hireHelpBtn");

  if(s.unlocked.newspaper) show("unlockNewsBtn");
  else hide("unlockNewsBtn");

  if(s.unlocked.newspaper) show("advertiseBtn");
  else hide("advertiseBtn");

  if(s.unlocked.bank){
    show("loanBtn");
    show("repayBtn");
  } else {
    hide("loanBtn");
    hide("repayBtn");
  }

  // ASCII updates
  renderAscii();
  renderTownFeatures();

  renderLog();
}

/* -------------------------
   9) START / SAVE / LOAD
   ------------------------- */

function startGame(){
  var roleKey = $("roleSelect").value;
  s = newState(roleKey);

  hide("setup_block");

  setNotice("Tip: Serve customers to earn money + reputation.", "yellow");

  render();
  log("You begin. The town watches.");
  startLoop();
  saveGame(true);
}

function saveGame(silent){
  if(!s) return;
  try{
    localStorage.setItem(SAVE_KEY, JSON.stringify(s));
    if(!silent){
      $("saveStatus").textContent = "Saved.";
      setTimeout(function(){ $("saveStatus").textContent = ""; }, 1200);
    }
  } catch(e){
    $("saveStatus").textContent = "Save failed (storage blocked).";
  }
}

function loadGame(){
  try{
    var raw = localStorage.getItem(SAVE_KEY);
    if(!raw){
      alert("No save found on this device.");
      return;
    }
    s = JSON.parse(raw);

    hide("setup_block");
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

/* -------------------------
   10) INIT
   ------------------------- */

(function init(){
  var raw = localStorage.getItem(SAVE_KEY);
  if(raw){
    var ss = $("saveStatus");
    if(ss) ss.textContent = "Save found on this device.";
  }
})();

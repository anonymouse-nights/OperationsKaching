/* =========================================================
   Town Trade - game.js
   Reliable UI hiding (uses el.hidden) + clear button costs
   Requires: ascii.js loads BEFORE this file
   ========================================================= */

var SAVE_KEY = "townTrade_cb_style_v4";

/* =========================
   BALANCE CONSTANTS (easy to tweak later)
   ========================= */
var DISCOUNT_COST = 5;            // Offer discount costs $5
var DISCOUNT_REP_GAIN = 2;        // ...and gives +2 reputation

var LOAN_CASH_AMOUNT = 200;       // Player receives $200
var LOAN_DEBT_AMOUNT = 220;       // Debt increases by $220 (built-in fee)
var REPAY_PER_CLICK = 10;         // Repay debt in $10 chunks

var UPGRADE_COST_STALL = 120;
var UPGRADE_COST_STOREFRONT = 480;
var UPGRADE_COST_HELPER = 260;
var UPGRADE_COST_GAZETTE = 200;

/* -----------------------------
   Roles
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

var STAGES = ["Stage 1", "Stage 2", "Stage 3"];

/* -----------------------------
   Runtime state
-------------------------------- */
var s = null;
var tickHandle = null;
var notice = { text: "", type: "" };

/* -----------------------------
   Crash display (shows errors near Save)
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

/* IMPORTANT: use hidden property so hiding always works */
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

    gazetteSupported: false,

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
   Economy
-------------------------------- */
function incomePerSecond(){
  var role = ROLES[s.roleKey];
  var stageBonus = s.stage * 0.8;
  return (role.baseIncome + stageBonus + s.incomeBonus) * s.demand;
}

/* -----------------------------
   UI reset / safety
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

  hide("ascii_display");
  hide("town_features");
  hide("ascii_gazette");
  hide("ascii_bank");
}

/* -----------------------------
   Button labels (shows costs on buttons)
-------------------------------- */
function updateButtonLabels(){
  // Action buttons
  if($("serveBtn")) setText("serveBtn", "Serve a customer");
  if($("goodDeedBtn")) setText("goodDeedBtn", "Offer discount to a customer (" + money(DISCOUNT_COST) + ", +" + DISCOUNT_REP_GAIN + " rep)");
  if($("loanBtn")) setText("loanBtn", "Take a small bank loan (" + money(LOAN_CASH_AMOUNT) + ")");
  if($("repayBtn")) setText("repayBtn", "Repay debt (" + money(REPAY_PER_CLICK) + " per click)");

  // Advertise cost changes with stage, so show the CURRENT cost
  if($("advertiseBtn") && s){
    var adCost = 30 + (s.stage * 10);
    setText("advertiseBtn", "Run a small advertisement (" + money(adCost) + ")");
  } else if($("advertiseBtn")) {
    setText("advertiseBtn", "Run a small advertisement");
  }

  // Upgrades (show cost directly)
  if($("upgradeToStallBtn")) setText("upgradeToStallBtn", "Upgrade: Stage 1 → Stage 2 (" + money(UPGRADE_COST_STALL) + ")");
  if($("upgradeToStoreBtn")) setText("upgradeToStoreBtn", "Upgrade: Stage 2 → Stage 3 (" + money(UPGRADE_COST_STOREFRONT) + ")");
  if($("hireHelpBtn")) setText("hireHelpBtn", "Hire steady help (" + money(UPGRADE_COST_HELPER) + ")");
  if($("unlockNewsBtn")) setText("unlockNewsBtn", "Support the Town Gazette (" + money(UPGRADE_COST_GAZETTE) + ")");
}

/* -----------------------------
   ASCII rendering
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

  if(s.roleKey === "general_store") caption.textContent = "You grow by keeping steady customers and trust.";
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

  s.money += incomePerSecond();

  if(s.seconds % 10 === 0){
    var drift = (s.reputation - 50) / 5000;
    s.demand = clamp(s.demand + drift, 0.85, 1.20);
  }

  // interest stays the same for now
  if(s.unlocked.bank && s.debt > 0 && s.seconds % 12 === 0){
    var interest = Math.max(1, Math.floor(s.debt * 0.02));
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
   Unlock logic + button timing
-------------------------------- */
function checkUnlocks(){
  show("serveBtn");
  show("goodDeedBtn");

  hide("advertiseBtn");
  hide("loanBtn");
  hide("repayBtn");
  hide("unlockNewsBtn");

  // Stall unlock
  if(!s.unlocked.stall && (s.money >= UPGRADE_COST_STALL || s.served >= 10)){
    s.unlocked.stall = true;
    show("upgrade_block");
    show("upgradeToStallBtn");
    log("You spot a better opportunity to expand.");
    setNotice("NEW UPGRADE AVAILABLE: Stage 1 → Stage 2", "yellow");
  }

  // Storefront unlock
  if(!s.unlocked.storefront && (s.money >= 450 || s.reputation >= 75)){
    s.unlocked.storefront = true;
    show("upgrade_block");
    show("upgradeToStoreBtn");
    log("A bigger expansion is possible now.");
    setNotice("NEW UPGRADE AVAILABLE: Stage 2 → Stage 3", "yellow");
  }

  // Gazette offer unlock
  if(!s.unlocked.newspaperOffer && (s.reputation >= 70 || s.goodServed >= 8)){
    s.unlocked.newspaperOffer = true;
    show("upgrade_block");
    log("The Town Gazette offers to feature you (for a price).");
    setNotice("NEW OPTION: Support the Town Gazette", "yellow");
  }

  // Support Gazette button visible until paid
  if(s.unlocked.newspaperOffer && !s.gazetteSupported){
    show("upgrade_block");
    show("unlockNewsBtn");
  }

  // Advertise only after paid support
  if(s.gazetteSupported){
    show("advertiseBtn");
  }

  // Bank unlock
  if(!s.unlocked.bank && (s.money >= 220 || s.stage >= 1)){
    s.unlocked.bank = true;
    log("The bank clerk offers you a loan. (Be careful.)");
    setNotice("NEW RISK: Bank loans unlocked. Debt gains interest.", "red");
  }

  // Loan/Repay only after bank unlocked
  if(s.unlocked.bank){
    show("loanBtn");
    show("repayBtn");
  }

  // Hire help appears at stage 2+
  if(s.stage >= 1){
    show("upgrade_block");
    show("hireHelpBtn");
  } else {
    hide("hireHelpBtn");
  }

  show("log");
}

/* -----------------------------
   Actions
-------------------------------- */
function serveCustomer(){
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
    setNotice("Careful: complaints hurt reputation (and long-term demand).", "red");
  }

  render();
  saveGame(true);
}

/* ✅ Renamed behavior: Offer discount */
function offerDiscount(){
  if(s.money < DISCOUNT_COST){
    log("You want to offer a discount, but you don't have enough cash.");
    setNotice("Not enough money for a discount.", "red");
    return;
  }

  s.money -= DISCOUNT_COST;
  s.reputation = clamp(s.reputation + DISCOUNT_REP_GAIN, 0, 100);

  log("You offered a discount. -" + money(DISCOUNT_COST) + ", +" + DISCOUNT_REP_GAIN + " reputation.");
  setNotice("Discount offered: reputation increased.", "yellow");

  render();
  saveGame(true);
}

/* Backward compatibility: if index.html still calls doGoodDeed() */
function doGoodDeed(){
  offerDiscount();
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
  setNotice("Advertising worked: demand increased.", "yellow");
  render();
  saveGame(true);
}

function takeLoan(){
  if(!s.unlocked.bank){
    log("No bank available yet.");
    return;
  }

  s.money += LOAN_CASH_AMOUNT;
  s.debt += LOAN_DEBT_AMOUNT;

  log("You took a bank loan: +" + money(LOAN_CASH_AMOUNT) + ". Debt increased by " + money(LOAN_DEBT_AMOUNT) + ".");
  setNotice("Loan taken: debt grows with interest.", "red");
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

function buyUpgrade(which){
  if(which === "stall"){
    var cost = UPGRADE_COST_STALL;
    if(s.money < cost){ log("You need " + money(cost) + " to upgrade."); return; }
    if(s.stage >= 1){ log("You already upgraded."); return; }

    s.money -= cost;
    s.stage = 1;
    s.incomeBonus += 1;

    log("Upgrade complete: Stage 1 → Stage 2.");
    setNotice("Upgrade purchased.", "yellow");
    render(); saveGame(true);
    return;
  }

  if(which === "storefront"){
    var cost2 = UPGRADE_COST_STOREFRONT;
    if(s.money < cost2){ log("You need " + money(cost2) + " to upgrade."); return; }
    if(s.stage >= 2){ log("You already have the top upgrade."); return; }
    if(s.stage < 1){ log("You need the first upgrade first."); return; }

    s.money -= cost2;
    s.stage = 2;
    s.incomeBonus += 3;

    log("Upgrade complete: Stage 2 → Stage 3.");
    setNotice("Upgrade purchased.", "yellow");
    render(); saveGame(true);
    return;
  }

  if(which === "helper"){
    var cost3 = UPGRADE_COST_HELPER;
    if(s.money < cost3){ log("You need " + money(cost3) + " to hire help."); return; }

    s.money -= cost3;
    s.incomeBonus += 2;
    s.repGainBonus += 1;

    log("You hired steady help.");
    setNotice("Upgrade purchased.", "yellow");
    render(); saveGame(true);
    return;
  }

  if(which === "newspaper"){
    var cost4 = UPGRADE_COST_GAZETTE;

    if(!s.unlocked.newspaperOffer){
      log("You haven't met the Gazette yet.");
      return;
    }

    if(s.gazetteSupported){
      log("The Gazette already supports you.");
      return;
    }

    if(s.money < cost4){
      log("You need " + money(cost4) + " to support the Gazette.");
      return;
    }

    s.money -= cost4;
    s.gazetteSupported = true;
    s.reputation = clamp(s.reputation + 6, 0, 100);

    log("The Gazette features your business. Advertising unlocked.");
    setNotice("Unlocked: advertising.", "yellow");
    render(); saveGame(true);
    return;
  }
}

/* -----------------------------
   Render
-------------------------------- */
function render(){
  if(!s) return;

  updateButtonLabels(); // ✅ keep button costs accurate

  var role = ROLES[s.roleKey];

  setHTML("role_line", "<b>Role:</b> " + role.name);
  setHTML("money_line", "<b>Money:</b> " + money(s.money) + " <span class='muted'>(Debt: " + money(s.debt) + ")</span>");
  setHTML("rep_line", "<b>Reputation:</b> " + s.reputation + " / 100");
  setHTML("stage_line", "<b>Progress:</b> " + STAGES[s.stage]);
  setHTML("income_line", "<b>Income:</b> " + incomePerSecond().toFixed(1) + " per second <span class='muted'>(Demand x" + s.demand.toFixed(2) + ")</span>");

  var baseStory = "";
  if(s.seconds < 8) baseStory = role.intro;
  else if(s.stage === 0) baseStory = "The town is small, but every honest sale matters. Keep serving customers.";
  else if(s.stage === 1) baseStory = "Your name is spreading. Reputation will shape your future here.";
  else baseStory = "You’ve become a real part of the town. Bigger decisions are coming.";

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
  show("log");

  if(s.unlocked.stall || s.unlocked.storefront || s.unlocked.newspaperOffer || s.stage >= 1) show("upgrade_block");
  else hide("upgrade_block");

  if(s.unlocked.stall && s.stage === 0) show("upgradeToStallBtn"); else hide("upgradeToStallBtn");
  if(s.unlocked.storefront && s.stage === 1) show("upgradeToStoreBtn"); else hide("upgradeToStoreBtn");
  if(s.stage >= 1) show("hireHelpBtn"); else hide("hireHelpBtn");
  if(s.unlocked.newspaperOffer && !s.gazetteSupported) show("unlockNewsBtn"); else hide("unlockNewsBtn");

  renderAscii();
  renderTownFeatures();
  renderLog();
}

/* -----------------------------
   Start / Save / Load / Restart
-------------------------------- */
function startGame(){
  var roleKey = $("roleSelect").value;
  s = newState(roleKey);

  hide("setup_block");
  resetUIBeforeStart();

  show("serveBtn");
  show("goodDeedBtn");

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
  updateButtonLabels();

  var raw = localStorage.getItem(SAVE_KEY);
  if(raw) setText("saveStatus", "Save found on this device.");
})();

/* =========================================================
   TOWN TRADE - GAME LOGIC
   This file controls:
   - game state (money, rep, stage, unlocks)
   - ticking income loop
   - button actions
   - rendering UI
   - saving/loading
   ========================================================= */

/* -------------------------
   1) GAME STATE + CONSTANTS
   ------------------------- */

var SAVE_KEY = "townTrade_cb_style_v1";

var ROLES = {
  general_store: {
    name: "General Store",
    intro: "You set up a tiny cart selling essentials. Flour, cloth, candles… whatever keeps the town alive.",
    baseIncome: 1.0,
    serveMoney: 8,
    serveRep: 2
  },
  blacksmith: {
    name: "Blacksmith",
    intro: "You start with a small forge corner. Repairs, horseshoes, hinges… fewer customers, bigger payouts.",
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

var STAGES = ["Cart in town", "Market stall", "Small storefront"];

// Main state object (becomes your save file)
var s = null;

// Loop controls
var tickHandle = null;
var lastTick = null;

// A “highlight message” shown above the story
var notice = { text: "", type: "" }; // type: "yellow" | "red" | ""

/* Build a fresh new save state */
function newState(roleKey){
  return {
    roleKey: roleKey,
    money: 50,
    reputation: 60,
    stage: 0,
    debt: 0,

    incomeBonus: 0,
    repGainBonus: 0,
    demand: 1.0,

    seconds: 0,
    served: 0,
    goodServed: 0,
    badServed: 0,

    unlocked: {
      cart: true,
      stall: false,
      storefront: false,
      newspaper: false,
      bank: false
    },

    logLines: []
  };
}

/* -------------------------
   2) SMALL UI HELPERS
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
  $(id).className = $(id).className.replace("hidden","");
}
function hide(id){
  if($(id).className.indexOf("hidden") === -1) $(id).className += " hidden";
}

function log(msg){
  var ts = new Date().toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});
  s.logLines.unshift("[" + ts + "] " + msg);
  if(s.logLines.length > 18) s.logLines.pop();
  renderLog();
}

function renderLog(){
  $("log").textContent = s.logLines.join("\n");
}

function setNotice(text, type){
  notice.text = text || "";
  notice.type = type || "";
}

/* -------------------------
   3) CORE GAME MATH + LOOP
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

  // Passive income every second
  s.money += incomePerSecond();

  // Demand drifts slowly based on reputation
  if(s.seconds % 10 === 0){
    var drift = (s.reputation - 50) / 5000;
    s.demand = clamp(s.demand + drift, 0.85, 1.20);
  }

  // Bank debt interest
  if(s.unlocked.bank && s.debt > 0 && s.seconds % 12 === 0){
    var interest = Math.max(1, Math.floor(s.debt * 0.02));
    s.debt += interest;
    log("Bank interest increased your debt by " + money(interest) + ".");
    if(s.debt >= 350){
      setNotice("WARNING: Your debt is getting dangerous.", "red");
    }
  }

  // Check if anything new should appear
  checkUnlocks();

  // Autosave
  if(s.seconds % 15 === 0) saveGame(true);

  render();
}

/* -------------------------
   4) UNLOCKS (things appear)
   ------------------------- */

function checkUnlocks(){
  s.unlocked.cart = true;

  if(!s.unlocked.stall && (s.money >= 120 || s.served >= 10)){
    s.unlocked.stall = true;
    show("upgrade_block");
    show("upgradeToStallBtn");
    show("town_object_stall");
    log("You notice a better spot in town… maybe you can upgrade into a stall.");
    setNotice("NEW UPGRADE AVAILABLE: Cart → Stall", "yellow");
  }

  if(!s.unlocked.storefront && (s.money >= 450 || s.reputation >= 75)){
    s.unlocked.storefront = true;
    show("upgradeToStoreBtn");
    show("town_object_storefront");
    log("A small storefront is up for rent. That would change everything.");
    setNotice("NEW UPGRADE AVAILABLE: Stall → Storefront", "yellow");
  }

  if(!s.unlocked.newspaper && (s.reputation >= 70 || s.goodServed >= 8)){
    s.unlocked.newspaper = true;
    show("unlockNewsBtn");
    show("town_object_newspaper");
    log("The Town Gazette offers to feature you (for a price).");
    setNotice("NEW OPTION: Support the Town Gazette (advertising)", "yellow");
  }

  if(!s.unlocked.bank && (s.money >= 220 || s.stage >= 1)){
    s.unlocked.bank = true;
    show("loanBtn");
    show("repayBtn");
    show("town_object_bank");
    log("The bank clerk offers you a loan. (Be careful.)");
    setNotice("NEW RISK: Bank loans unlocked. Debt gains interest.", "red");
  }

  // Core actions show after start
  show("serveBtn");
  show("goodDeedBtn");

  if(s.unlocked.newspaper) show("advertiseBtn");
}

/* -------------------------
   5) BUTTON ACTIONS
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
  if(which === "stall"){
    var cost = 120;
    if(s.money < cost){ log("You need " + money(cost) + " to upgrade."); setNotice("Need " + money(cost) + " for Cart → Stall.", "red"); return; }
    if(s.stage >= 1){ log("You already have a stall or better."); return; }
    s.money -= cost;
    s.stage = 1;
    s.incomeBonus += 1;
    log("Upgrade complete: Cart → Stall. Income increased.");
    setNotice("Upgrade purchased: Cart → Stall", "yellow");
    render(); saveGame(true);
    return;
  }

  if(which === "storefront"){
    var cost2 = 480;
    if(s.money < cost2){ log("You need " + money(cost2) + " to upgrade."); setNotice("Need " + money(cost2) + " for Stall → Storefront.", "red"); return; }
    if(s.stage >= 2){ log("You already have a storefront."); return; }
    if(s.stage < 1){ log("You need the stall first."); setNotice("You need the Stall before the Storefront.", "red"); return; }
    s.money -= cost2;
    s.stage = 2;
    s.incomeBonus += 3;
    log("Upgrade complete: Stall → Storefront. Steady income jumped.");
    setNotice("Upgrade purchased: Stall → Storefront", "yellow");
    render(); saveGame(true);
    return;
  }

  if(which === "helper"){
    var cost3 = 260;
    if(s.money < cost3){ log("You need " + money(cost3) + " to hire help."); setNotice("Need " + money(cost3) + " to hire help.", "red"); return; }
    s.money -= cost3;
    s.incomeBonus += 2;
    s.repGainBonus += 1;
    log("You hired steady help. Income +2/sec and customer service improves.");
    setNotice("Upgrade purchased: Steady help hired.", "yellow");
    render(); saveGame(true);
    return;
  }

  if(which === "newspaper"){
    var cost4 = 200;
    if(s.money < cost4){ log("You need " + money(cost4) + " to support the Gazette."); setNotice("Need " + money(cost4) + " to support the Gazette.", "red"); return; }
    s.money -= cost4;
    s.unlocked.newspaper = true;
    s.reputation = clamp(s.reputation + 6, 0, 100);
    log("The Gazette features your business. Advertising unlocked.");
    setNotice("Unlocked: advertising (Gazette).", "yellow");
    render(); saveGame(true);
    return;
  }
}

/* -------------------------
   6) RENDERING (update screen)
   ------------------------- */

function render(){
  var role = ROLES[s.roleKey];

  $("role_line").innerHTML = "<b>Role:</b> " + role.name;
  $("money_line").innerHTML = "<b>Money:</b> " + money(s.money) + " <span class='muted'>(Debt: " + money(s.debt) + ")</span>";
  $("rep_line").innerHTML = "<b>Reputation:</b> " + s.reputation + " / 100";
  $("stage_line").innerHTML = "<b>Business:</b> " + STAGES[s.stage];
  $("income_line").innerHTML = "<b>Income:</b> " + incomePerSecond().toFixed(1) + " per second <span class='muted'>(Demand x" + s.demand.toFixed(2) + ")</span>";

  var baseStory = "";
  if(s.seconds < 8){
    baseStory = role.intro;
  } else if(s.stage === 0){
    baseStory = "The town is small, but every honest sale matters. Keep serving customers.";
  } else if(s.stage === 1){
    baseStory = "Your stall is drawing attention. Reputation will decide your long-term future here.";
  } else {
    baseStory = "A storefront changes your standing. Bigger decisions are coming (laws, taxes, competition).";
  }

  var noticeHtml = "";
  if(notice.text){
    if(notice.type === "yellow") noticeHtml = "<span class='notice-yellow'>" + notice.text + "</span><br/><br/>";
    else if(notice.type === "red") noticeHtml = "<span class='notice-red'>" + notice.text + "</span><br/><br/>";
    else noticeHtml = notice.text + "<br/><br/>";
  }

  $("story_line").innerHTML = noticeHtml + baseStory;

  // Right-side objects
  if(s.unlocked.cart) show("town_object_cart");
  if(s.stage >= 1) show("town_object_stall");
  if(s.stage >= 2) show("town_object_storefront");
  if(s.unlocked.newspaper) show("town_object_newspaper");
  if(s.unlocked.bank) show("town_object_bank");

  // Show UI blocks
  show("role_line");
  show("money_line");
  show("rep_line");
  show("stage_line");
  show("income_line");
  show("story_line");
  show("serveBtn");
  show("goodDeedBtn");
  show("log");

  // Upgrades
  if(s.unlocked.stall) show("upgrade_block");
  if(s.unlocked.stall && s.stage === 0) show("upgradeToStallBtn");
  if(s.unlocked.storefront && s.stage === 1) show("upgradeToStoreBtn");
  if(s.stage >= 1) show("hireHelpBtn");
  if(s.unlocked.newspaper) show("unlockNewsBtn");

  if(s.unlocked.newspaper) show("advertiseBtn");
  if(s.unlocked.bank) { show("loanBtn"); show("repayBtn"); }

  renderLog();
}

/* -------------------------
   7) START / SAVE / LOAD
   ------------------------- */

function startGame(){
  var roleKey = $("roleSelect").value;
  s = newState(roleKey);

  hide("setup_block");
  show("town_object_cart");

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
    if(!raw){ alert("No save found on this device."); return; }
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

/* When page loads, show “save found” if it exists */
(function init(){
  var raw = localStorage.getItem(SAVE_KEY);
  if(raw){
    $("saveStatus").textContent = "Save found on this device.";
  }
})();

/* =========================================================
   Town Trade - CORE ENGINE (FINAL-ISH HARD MODE)
   ---------------------------------------------------------
   Goals implemented here:
   ✅ Slow, difficult economic survival
   ✅ Time is a resource (most meaningful actions can cost hours)
   ✅ No guaranteed customers (roles determine, but engine supports)
   ✅ Reputation is powerful but decays (can't grind it forever)
   ✅ Demand shocks + streak protection via seeded RNG
   ✅ Daily overhead (growth = risk multiplier)
   ✅ Town features ASCII support (bank/gazette) + role ASCII fallback
   ✅ Dynamic action system (roles can define actions array)
   ✅ Backwards compatible with your existing role modules + HTML
   ========================================================= */

/* =========================
   GLOBAL REGISTRY
   ========================= */
window.TT = window.TT || {};
window.TT_ROLES = window.TT_ROLES || {};       // role modules register here
window.TT_ASCII = window.TT_ASCII || {};       // optional ascii registry (extra)
window.TT_VERSION = "core_v2_finalish";

/* =========================
   SAVE KEY
   ========================= */
var SAVE_KEY = "townTrade_save_core_v2_finalish";

/* =========================
   DEFAULT ROLE LIST (UI only)
   ========================= */
var ROLE_CATALOG = [
  { key: "general_store", label: "General Store / Trading Post" },
  { key: "blacksmith", label: "Blacksmith" },
  { key: "mill", label: "Mill (Grain or Sawmill)" },
  { key: "tavern_inn", label: "Tavern / Inn" },
  { key: "carpenter_builder", label: "Carpenter / Builder" },
  { key: "butcher", label: "Butcher" },
  { key: "baker", label: "Baker" },
  { key: "stable_livery", label: "Stable / Livery" },
  { key: "doctor_apothecary", label: "Doctor / Apothecary" },
  { key: "church_meeting_house", label: "Church / Meeting House" },
  // NOTE: keep boarding_house out of catalog until role exists
];

/* =========================
   ECONOMY SETTINGS (HARD MODE)
   ========================= */
var TT_ECON = {
  HOURS_PER_DAY: 12,

  // Growth = more pressure
  overheadByStage: [0, 12, 30], // daily fixed cost per stage (cart/stall/store)

  // Rep is an investment, but it fades if you stop tending it
  repDecayPerDay: 1, // moves rep toward 0 each day

  // Demand shock persists across the day (weather, migration, rumor)
  dailyDemandShockMin: 0.85,
  dailyDemandShockMax: 1.15,

  // Soft streak protection so it doesn't feel rigged
  // (does NOT guarantee customers; it just reduces "extreme dead streak" pain)
  badLuckBufferMax: 3,

  // Debt pressure (optional; roles can ignore, engine applies if debt exists)
  debtInterestPerDayRate: 0.02, // 2% daily interest (harsh on purpose)
  debtGraceThreshold: 0 // set >0 if you want some free debt before interest
};

/* =========================
   CORE STATE
   ========================= */
var s = null;
var tickHandle = null;

/* =========================
   CRASH DISPLAY (shows errors in saveStatus)
   ========================= */
window.onerror = function (msg, url, line, col) {
  try {
    var ss = document.getElementById("saveStatus");
    if (ss) ss.textContent = "ERROR: " + msg + " (line " + line + ")";
  } catch (e) {}
  return false;
};

/* =========================
   DOM HELPERS
   ========================= */
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
  if(!el) return;
  el.classList.remove("hidden");
}

function hide(id){
  var el = $(id);
  if(!el) return;
  if(!el.classList.contains("hidden")) el.classList.add("hidden");
}

function clamp(n, a, b){
  if(n < a) return a;
  if(n > b) return b;
  return n;
}

function money(n){
  n = Math.floor(n || 0);
  return "$" + n.toString();
}

/* =========================
   NOTICE + LOG
   ========================= */
function setNotice(text, type){
  if(!s) return;
  s.notice = s.notice || { text:"", type:"" };
  s.notice.text = text || "";
  s.notice.type = type || "";
}

function log(msg){
  if(!s) return;
  var ts = new Date().toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});
  s.logLines.unshift("[" + ts + "] " + msg);
  if(s.logLines.length > 22) s.logLines.pop();
  renderLog();
}

function renderLog(){
  if(!s) return;
  var el = $("log");
  if(!el) return;
  el.textContent = (s.logLines || []).join("\n");
}

/* =========================
   SEEDED RNG (Fair Randomness)
   - Stored in save
   ========================= */
function hashStringToSeed(str){
  str = String(str || "");
  var h = 2166136261;
  for (var i = 0; i < str.length; i++){
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) || 1;
}

// Mulberry32
function seededRand(st){
  st.rngState = (st.rngState >>> 0) || 1;
  var t = (st.rngState += 0x6D2B79F5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/* =========================
   ROLE MODULE ACCESS
   ========================= */
function getRoleModule(roleKey){
  return (window.TT_ROLES && window.TT_ROLES[roleKey]) ? window.TT_ROLES[roleKey] : null;
}

function getActiveRoleModule(){
  if(!s) return null;
  return getRoleModule(s.roleKey);
}

function roleName(roleKey){
  var mod = getRoleModule(roleKey);
  if(mod && mod.meta && mod.meta.name) return mod.meta.name;

  for(var i=0;i<ROLE_CATALOG.length;i++){
    if(ROLE_CATALOG[i].key === roleKey) return ROLE_CATALOG[i].label;
  }
  return roleKey;
}

function roleIntro(roleKey){
  var mod = getRoleModule(roleKey);
  if(mod && mod.meta && mod.meta.intro) return mod.meta.intro;
  return "You open for business in a growing town. Your choices will shape your future.";
}

/* =========================
   TIME SYSTEM
   ========================= */
var HOURS_PER_DAY = TT_ECON.HOURS_PER_DAY;

function initTime(st){
  if(typeof st.seconds !== "number") st.seconds = 0;
  if(typeof st.hours !== "number") st.hours = 0;       // total hours passed
  if(typeof st.dayCount !== "number") st.dayCount = 0; // day number based on hours
  if(typeof st.hourOfDay !== "number") st.hourOfDay = 0; // 0..HOURS_PER_DAY-1
  if(typeof st.daySeed !== "number") st.daySeed = 0;   // daily event seed
}

function computeDayShock(st){
  // Persist per day
  if(st._shockDay === st.dayCount && typeof st._dayShock === "number"){
    return st._dayShock;
  }
  st._shockDay = st.dayCount;

  // deterministic-ish from seeded RNG but still "random"
  var r = seededRand(st);
  st._dayShock = TT_ECON.dailyDemandShockMin + (TT_ECON.dailyDemandShockMax - TT_ECON.dailyDemandShockMin) * r;
  return st._dayShock;
}

function applyDailySystems(st, api){
  // 1) Fixed overhead (growth risk)
  var stage = clamp(st.stage || 0, 0, 2);
  var overhead = TT_ECON.overheadByStage[stage] || 0;
  if(overhead > 0){
    st.money -= overhead;
    api.log("Daily overhead: -" + money(overhead) + " (rent/fees).");
    if(st.money < 0){
      api.setNotice("Overhead hit while low on cash.", "red");
    }
  }

  // 2) Debt interest
  if((st.debt || 0) > TT_ECON.debtGraceThreshold){
    var interest = Math.max(1, Math.floor(st.debt * TT_ECON.debtInterestPerDayRate));
    st.debt += interest;
    api.log("Debt interest: +" + money(interest) + " added to debt.");
  }

  // 3) Rep decay toward 0
  if(typeof st.reputation !== "number") st.reputation = 0;
  var d = TT_ECON.repDecayPerDay;
  if(d > 0){
    if(st.reputation > 0) st.reputation = Math.max(0, st.reputation - d);
    else if(st.reputation < 0) st.reputation = Math.min(0, st.reputation + d);
  }

  // 4) New daily demand shock
  var shock = computeDayShock(st);
  api.log("New day mood: demand x" + shock.toFixed(2) + ".");
}

function passHours(st, api, hours){
  hours = Math.max(1, Math.floor(hours || 1));

  for(var i=0; i<hours; i++){
    st.hours += 1;

    var prevDay = st.dayCount;
    st.dayCount = Math.floor(st.hours / HOURS_PER_DAY);
    st.hourOfDay = st.hours % HOURS_PER_DAY;

    // role hourly hook
    var mod = getActiveRoleModule();
    if(mod && typeof mod.onHour === "function"){
      try { mod.onHour(st, api); } catch(e){ console.error(e); }
    }

    // day transition
    if(st.dayCount !== prevDay){
      // engine daily systems first (hard mode pressure)
      try { applyDailySystems(st, api); } catch(e0){ console.error(e0); }

      // then role daily hook
      if(mod && typeof mod.onNewDay === "function"){
        try { mod.onNewDay(st, api); } catch(e2){ console.error(e2); }
      }
    }
  }
}

/* =========================
   STATE FACTORY
   ========================= */
function newState(roleKey){
  // create a seed stable-ish per device + roleKey
  var baseSeed = hashStringToSeed(roleKey + "|" + navigator.userAgent + "|" + (new Date().toDateString()));

  var base = {
    version: window.TT_VERSION,
    roleKey: roleKey,

    // shared resources
    money: 0,
    reputation: 0,
    stage: 0,
    debt: 0,
    demand: 1.0,

    // time
    seconds: 0,
    hours: 0,
    dayCount: 0,
    hourOfDay: 0,
    daySeed: 0,

    // seeded rng
    rngSeed: baseSeed,
    rngState: baseSeed,

    // streak buffer (reduces "this is rigged" moments)
    badLuckBuffer: 0,

    unlocked: {},

    // UI
    notice: { text:"", type:"" },

    // log
    logLines: []
  };

  initTime(base);

  // set initial daily shock
  computeDayShock(base);

  var mod = getRoleModule(roleKey);
  if(mod && typeof mod.init === "function"){
    try { mod.init(base); } catch(e){ console.error(e); }
  }

  initTime(base);
  computeDayShock(base);

  return base;
}

/* =========================
   ACTION SYSTEM
   - Roles may provide getActions(st, api) => [{id,label,hours,enabled,tooltip}]
   - Backwards compatible: roles with buttons() + functions still work
   ========================= */
function ensureActionBlock(){
  var existing = $("actions_block");
  if(existing) return existing;

  // Insert before log if possible
  var logEl = $("log");
  if(logEl && logEl.parentNode){
    var div = document.createElement("div");
    div.id = "actions_block";
    div.style.marginBottom = "10px";
    logEl.parentNode.insertBefore(div, logEl);
    return div;
  }

  // fallback: append to body
  var d2 = document.createElement("div");
  d2.id = "actions_block";
  document.body.appendChild(d2);
  return d2;
}

function normalizeActions(actions){
  actions = actions || [];
  var out = [];
  for(var i=0;i<actions.length;i++){
    var a = actions[i];
    if(!a || !a.id || !a.label) continue;
    out.push({
      id: a.id,
      label: a.label,
      hours: Math.max(0, Math.floor(a.hours || 0)),
      enabled: (a.enabled !== false),
      tooltip: a.tooltip || ""
    });
  }
  return out;
}

function legacyActionsFromRole(st, api){
  var mod = getActiveRoleModule();
  if(!mod) return [];

  // If role provides getActions, use it
  if(typeof mod.getActions === "function"){
    try { return normalizeActions(mod.getActions(st, api)); } catch(e){ console.error(e); }
  }

  // Legacy "buttons()" -> map to standard actions
  if(typeof mod.buttons === "function"){
    var b = {};
    try { b = mod.buttons(st, api) || {}; } catch(e2){ console.error(e2); }

    var acts = [];

    // Always provide "Wait" (time passes; sometimes necessary)
    acts.push({ id:"wait", label:"Wait 1 hour", hours:1, enabled:true, tooltip:"Time passes. Sometimes waiting is the least bad choice." });

    if(b.serve) acts.push({ id:"serve", label:"Serve a customer", hours:1, enabled:true, tooltip:"Try to make sales. Time passes." });
    if(b.discount) acts.push({ id:"discount", label:"Offer discount / goodwill", hours:1, enabled:true, tooltip:"Costs money (role-defined) and takes time." });
    if(b.advertise) acts.push({ id:"advertise", label:"Run a small advertisement", hours:2, enabled:true, tooltip:"Costs money, may improve demand." });
    if(b.loan) acts.push({ id:"loan", label:"Take a small bank loan", hours:1, enabled:true, tooltip:"Debt is dangerous long-term." });
    if(b.repay) acts.push({ id:"repay", label:"Repay some debt", hours:1, enabled:true, tooltip:"Reduce debt pressure." });

    // Upgrades (legacy)
    if(b.upgrades){
      if(b.upgrades.stall) acts.push({ id:"upgrade_stall", label:"Upgrade: Cart → Stall", hours:2, enabled:true, tooltip:"Growth increases pressure (daily overhead)." });
      if(b.upgrades.storefront) acts.push({ id:"upgrade_storefront", label:"Upgrade: Stall → Storefront", hours:3, enabled:true, tooltip:"Bigger risk multiplier." });
      if(b.upgrades.helper) acts.push({ id:"upgrade_helper", label:"Hire steady help", hours:2, enabled:true, tooltip:"Costs money; may improve throughput." });
      if(b.upgrades.newspaper) acts.push({ id:"upgrade_newspaper", label:"Support the Town Gazette", hours:2, enabled:true, tooltip:"Unlocks town news / demand hints." });
    }

    return normalizeActions(acts);
  }

  // If nothing else, at least wait exists
  return normalizeActions([{ id:"wait", label:"Wait 1 hour", hours:1, enabled:true }]);
}

function renderActions(){
  if(!s) return;
  var block = ensureActionBlock();
  if(!block) return;

  var actions = legacyActionsFromRole(s, TT_API);

  // Hide legacy fixed buttons so we don't double-render
  hide("serveBtn"); hide("goodDeedBtn"); hide("advertiseBtn"); hide("loanBtn"); hide("repayBtn");
  hide("upgrade_block"); hide("upgradeToStallBtn"); hide("upgradeToStoreBtn"); hide("hireHelpBtn"); hide("unlockNewsBtn");

  var html = "<b>Actions:</b><br/>";
  for(var i=0;i<actions.length;i++){
    var a = actions[i];
    var disabled = a.enabled ? "" : "disabled";
    var tip = a.tooltip ? (" title=\"" + escapeHtml(a.tooltip) + "\"") : "";
    var hoursTxt = (a.hours > 0) ? (" <span class='muted tiny'>(+" + a.hours + "h)</span>") : "";
    html += "<button class='home_button' style='margin-bottom:2px;' onclick=\"TT_DO_ACTION('" + a.id + "')\" " + disabled + tip + ">" +
            escapeHtml(a.label) + "</button>" + hoursTxt + "<br/>";
  }
  block.innerHTML = html;
}

function escapeHtml(s0){
  s0 = String(s0 || "");
  return s0
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;")
    .replace(/'/g,"&#039;");
}

window.TT_DO_ACTION = function(actionId){
  doAction(actionId);
};

function doAction(actionId){
  if(!s) return;

  var mod = getActiveRoleModule();

  // Always valid: wait
  if(actionId === "wait"){
    TT_API.passHours(1);
    setNotice("You wait. Time passes.", "yellow");
    log("Waited 1 hour.");
    render();
    saveGame(true);
    return;
  }

  // Upgrades mapping (legacy)
  if(actionId.indexOf("upgrade_") === 0){
    var which = actionId.replace("upgrade_", "");
    onAction("upgrade_" + which, 0); // role decides time cost if needed
    return;
  }

  // Default: dispatch to role function by name
  onAction(actionId, 0);
}

/* =========================
   LEGACY DISPATCH (kept for HTML onclick compatibility)
   ========================= */
function onAction(actionName, forcedHours){
  if(!s) return;

  var mod = getRoleModule(s.roleKey);

  // If we have an action definition, use its hour cost (unless forcedHours provided)
  var hoursToPass = 0;
  var actions = legacyActionsFromRole(s, TT_API);
  for(var i=0;i<actions.length;i++){
    if(actions[i].id === actionName){
      hoursToPass = actions[i].hours || 0;
      break;
    }
  }
  if(typeof forcedHours === "number" && forcedHours > 0) hoursToPass = forcedHours;

  // If role implements action
  if(mod && typeof mod[actionName] === "function"){
    // time cost first (so player feels time pressure even if action fails)
    if(hoursToPass > 0){
      TT_API.passHours(hoursToPass);
    }

    try {
      mod[actionName](s, TT_API);
    } catch(e){
      console.error(e);
      setNotice("That action caused an error.", "red");
      log("Action error: " + actionName);
    }

    render();
    saveGame(true);
    return;
  }

  log("Nothing happens. (This role doesn’t implement: " + actionName + ")");
  setNotice("That action isn't available for this role yet.", "red");
  render();
}

/* Legacy function names used by your HTML */
function serveCustomer(){ doAction("serve"); }
function doGoodDeed(){ doAction("discount"); }
function advertise(){ doAction("advertise"); }
function takeLoan(){ doAction("loan"); }
function repayLoan(){ doAction("repay"); }
function buyUpgrade(which){ doAction("upgrade_" + which); }

/* FIX: Your HTML currently calls offerDiscount() */
function offerDiscount(){ doGoodDeed(); }

/* =========================
   CORE LOOP
   - 1s tick remains for UI + optional role tick
   - Meaningful time is advanced via passHours()
   ========================= */
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

  // keep seconds for any effects that still want "real-time"
  s.seconds += 1;

  var mod = getActiveRoleModule();
  if(mod && typeof mod.tick === "function"){
    try { mod.tick(s, TT_API); } catch(e){ console.error(e); }
  }

  // autosave
  if(s.seconds % 15 === 0) saveGame(true);

  render();
}

/* =========================
   ASCII RENDER
   - Role can define getAscii(st, api)
   - Otherwise falls back to ASCII_ART[roleKey][stage] if present
   - Town features use TOWN_ASCII if unlocked
   ========================= */
function renderAscii(){
  var art = $("ascii_display");
  var cap = $("ascii_caption");
  if(!art || !cap || !s) return;

  var mod = getActiveRoleModule();
  var out = null;

  if(mod && typeof mod.getAscii === "function"){
    try { out = mod.getAscii(s, TT_API); } catch(e){ console.error(e); }
  }

  if(!out){
    // Fallback to ascii.js globals (your file defines ASCII_ART and TOWN_ASCII)
    try{
      var A = (typeof ASCII_ART !== "undefined") ? ASCII_ART : null;
      if(A && A[s.roleKey] && A[s.roleKey][s.stage] != null){
        out = { art: A[s.roleKey][s.stage], caption: "" };
      }
    } catch(e2){}
  }

  if(out && out.art){
    art.textContent = out.art || "";
    cap.textContent = out.caption || "";
    show("ascii_display");
  } else {
    art.textContent = "";
    cap.textContent = "";
    hide("ascii_display");
  }

  // Town features ASCII (bank / gazette)
  var tf = $("town_features");
  var g = $("ascii_gazette");
  var b = $("ascii_bank");
  if(tf && g && b){
    var T = null;
    try { T = (typeof TOWN_ASCII !== "undefined") ? TOWN_ASCII : null; } catch(e3){}

    var showAny = false;

    if(T && T.gazette && TT_API.isUnlocked("gazette")){
      g.textContent = T.gazette;
      show("ascii_gazette");
      showAny = true;
    } else {
      g.textContent = "";
      hide("ascii_gazette");
    }

    if(T && T.bank && TT_API.isUnlocked("bank")){
      b.textContent = T.bank;
      show("ascii_bank");
      showAny = true;
    } else {
      b.textContent = "";
      hide("ascii_bank");
    }

    if(showAny) show("town_features");
    else hide("town_features");
  }
}

/* =========================
   RENDER CORE UI
   ========================= */
function render(){
  if(!s) return;

  // main lines
  setHTML("role_line", "<b>Role:</b> " + escapeHtml(roleName(s.roleKey)));
  setHTML("money_line", "<b>Money:</b> " + money(s.money) + " <span class='muted'>(Debt: " + money(s.debt) + ")</span>");
  setHTML("rep_line", "<b>Reputation:</b> " + (s.reputation || 0));

  // day mood
  var shock = computeDayShock(s);

  setHTML(
    "stage_line",
    "<b>Business:</b> Stage " + ((s.stage || 0) + 1) +
    " <span class='muted'>(Day " + ((s.dayCount || 0) + 1) + ", Hour " + ((s.hourOfDay || 0) + 1) + " / " + HOURS_PER_DAY +
    ", Mood x" + shock.toFixed(2) + ")</span>"
  );

  setHTML("income_line", "<b>Status:</b> Demand x" + ((s.demand || 1).toFixed(2)));

  // story line + notices
  var baseStory = roleIntro(s.roleKey);

  var mod = getActiveRoleModule();
  if(mod && typeof mod.story === "function"){
    try { baseStory = mod.story(s, TT_API) || baseStory; } catch(e){ console.error(e); }
  }

  var n = (s.notice || {text:"", type:""});
  var noticeHtml = "";
  if(n && n.text){
    if(n.type === "yellow") noticeHtml = "<span class='notice-yellow'>" + escapeHtml(n.text) + "</span><br/><br/>";
    else if(n.type === "red") noticeHtml = "<span class='notice-red'>" + escapeHtml(n.text) + "</span><br/><br/>";
    else noticeHtml = escapeHtml(n.text) + "<br/><br/>";
  }
  setHTML("story_line", noticeHtml + baseStory);

  show("role_line");
  show("money_line");
  show("rep_line");
  show("stage_line");
  show("income_line");
  show("story_line");
  show("log");

  // role extras
  if(mod && typeof mod.renderExtra === "function"){
    try { mod.renderExtra(s, TT_API); } catch(e2){ console.error(e2); }
  }

  // actions + ascii
  renderActions();
  renderAscii();
  renderLog();
}

/* =========================
   ROLE-FACING API (stable)
   ========================= */
var TT_API = {
  // UI + helpers
  $, show, hide, setHTML, setText, money, clamp, setNotice: setNotice, log: log,

  // persistence
  save: function(){ saveGame(true); },

  // seeded random
  rand: function(){
    if(!s) return Math.random();
    return seededRand(s);
  },
  roll: function(num, sides){
    num = Math.max(1, Math.floor(num || 1));
    sides = Math.max(2, Math.floor(sides || 6));
    var total = 0;
    for(var i=0;i<num;i++){
      total += 1 + Math.floor(TT_API.rand() * sides);
    }
    return total;
  },
  randomRange: function(a,b){
    a = Number(a); b = Number(b);
    if(!isFinite(a)) a = 0;
    if(!isFinite(b)) b = 1;
    if(b < a){ var t=a; a=b; b=t; }
    return a + (b - a) * TT_API.rand();
  },

  // staged unlock bag
  unlock: function(key){ if(!s) return; s.unlocked[key] = true; },
  isUnlocked: function(key){ return !!(s && s.unlocked && s.unlocked[key]); },

  // global time control
  passHours: function(n){
    if(!s) return;
    passHours(s, TT_API, n);
  },

  // daily mood (roles can factor this into customers)
  dayShock: function(){
    if(!s) return 1.0;
    return computeDayShock(s);
  },

  // gentle rep helper
  changeReputation: function(delta, reason){
    if(!s) return;
    delta = Math.floor(delta || 0);
    s.reputation = (s.reputation || 0) + delta;
    s.reputation = clamp(s.reputation, -100, 100);
    if(reason) log("Reputation " + (delta>=0?"+":"") + delta + ": " + reason);
  },

  // demand helper
  changeDemand: function(delta, reason){
    if(!s) return;
    if(typeof s.demand !== "number") s.demand = 1.0;
    s.demand = clamp(s.demand + Number(delta || 0), 0.50, 1.75);
    if(reason) log("Demand changed: " + reason + " (x" + s.demand.toFixed(2) + ").");
  },

  // pressure helper (used by roles if they want)
  applyCost: function(amount, label){
    if(!s) return;
    amount = Math.max(0, Math.floor(amount || 0));
    if(amount <= 0) return;
    s.money -= amount;
    if(label) log(label + ": -" + money(amount) + ".");
  }
};

/* =========================
   START GAME
   ========================= */
function populateRoleDropdown(){
  var sel = $("roleSelect");
  if(!sel) return;

  // Always clear and repopulate based on ROLE_CATALOG + any existing options
  // but keep user's HTML options too (won't break)
  if(sel._ttPopulated) return;
  sel._ttPopulated = true;

  // If HTML already has options, don't duplicate them.
  // Still ensure catalog roles exist if select is empty.
  if(sel.options && sel.options.length > 0) return;

  for(var i=0;i<ROLE_CATALOG.length;i++){
    var opt = document.createElement("option");
    opt.value = ROLE_CATALOG[i].key;
    opt.textContent = ROLE_CATALOG[i].label;
    sel.appendChild(opt);
  }
}

function startGame(){
  var roleKey = $("roleSelect") ? $("roleSelect").value : "general_store";
  s = newState(roleKey);

  hide("setup_block");

  var mod = getRoleModule(roleKey);
  if(mod && typeof mod.start === "function"){
    try { mod.start(s, TT_API); } catch(e){ console.error(e); }
  } else {
    s.money = 100;
    s.reputation = 0;
    setNotice("This role isn’t implemented yet. Try General Store once it exists.", "red");
    log("Role module not found for: " + roleKey);
  }

  // Engine daily systems should apply at day 1 start? (optional)
  // We avoid double-charging overhead on day 0.

  render();
  startLoop();
  saveGame(true);
}

/* =========================
   SAVE / LOAD / RESTART
   ========================= */
function migrateSave(st){
  st = st || {};

  // version + defaults
  if(!st.version) st.version = window.TT_VERSION;
  if(typeof st.roleKey !== "string") st.roleKey = "general_store";

  if(typeof st.money !== "number") st.money = 0;
  if(typeof st.reputation !== "number") st.reputation = 0;
  if(typeof st.stage !== "number") st.stage = 0;
  if(typeof st.debt !== "number") st.debt = 0;
  if(typeof st.demand !== "number") st.demand = 1.0;

  if(!st.unlocked) st.unlocked = {};
  if(!st.notice) st.notice = { text:"", type:"" };
  if(!st.logLines) st.logLines = [];

  // rng fields
  if(typeof st.rngSeed !== "number"){
    st.rngSeed = hashStringToSeed(st.roleKey + "|" + navigator.userAgent);
  }
  if(typeof st.rngState !== "number"){
    st.rngState = st.rngSeed;
  }
  if(typeof st.badLuckBuffer !== "number"){
    st.badLuckBuffer = 0;
  }

  // time
  initTime(st);
  computeDayShock(st);

  return st;
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
    s = migrateSave(s);

    hide("setup_block");

    var mod = getRoleModule(s.roleKey);
    if(mod && typeof mod.onLoad === "function"){
      try { mod.onLoad(s, TT_API); } catch(e1){ console.error(e1); }
    }

    setNotice("Loaded save.", "yellow");
    log("Loaded save.");
    render();
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

/* =========================
   INIT
   ========================= */
(function init(){
  populateRoleDropdown();

  var raw = localStorage.getItem(SAVE_KEY);
  if(raw) setText("saveStatus", "Save found on this device.");

  hide("role_line");
  hide("money_line");
  hide("rep_line");
  hide("stage_line");
  hide("income_line");
  hide("story_line");
  hide("log");

  // hide legacy buttons
  hide("serveBtn");
  hide("goodDeedBtn");
  hide("advertiseBtn");
  hide("loanBtn");
  hide("repayBtn");
  hide("upgrade_block");

  // pre-create action block container (safe)
  ensureActionBlock();
})();

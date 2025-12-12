/* =========================================================
   Town Trade - CORE ENGINE (no role gameplay)
   ---------------------------------------------------------
   This file is meant to be "final" and not edited later.

   Role gameplay lives in separate files like:
     roles/general_store.js
     roles/blacksmith.js
     roles/mill.js
     roles/tavern_inn.js
     roles/carpenter_builder.js
     roles/butcher.js
     roles/baker.js
     roles/stable_livery.js
     roles/doctor_apothecary.js
     roles/church_meeting_house.js

   Each role file registers itself into TT_ROLES:
     TT_ROLES["general_store"] = { ...role module... }

   ========================================================= */

/* =========================
   GLOBAL REGISTRY
   ========================= */
window.TT = window.TT || {};
window.TT_ROLES = window.TT_ROLES || {};       // role modules register here
window.TT_ASCII = window.TT_ASCII || {};       // optional ascii registry
window.TT_VERSION = "core_v1";

/* =========================
   SAVE KEY
   ========================= */
var SAVE_KEY = "townTrade_save_core_v1";

/* =========================
   DEFAULT ROLE LIST (UI only)
   - These are the roles your UI will offer.
   - Role modules can override name/desc via TT_ROLES config.
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
  { key: "church_meeting_house", label: "Church / Meeting House" }
];

/* =========================
   CORE STATE
   ========================= */
var s = null;
var tickHandle = null;
var notice = { text: "", type: "" };

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

function setNotice(text, type){
  notice.text = text || "";
  notice.type = type || "";
}

/* =========================
   LOG
   ========================= */
function log(msg){
  if(!s) return;
  var ts = new Date().toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});
  s.logLines.unshift("[" + ts + "] " + msg);
  if(s.logLines.length > 18) s.logLines.pop();
  renderLog();
}

function renderLog(){
  if(!s) return;
  var el = $("log");
  if(!el) return;
  el.textContent = s.logLines.join("\n");
}

/* =========================
   ROLE MODULE ACCESS
   ========================= */
function getRoleModule(roleKey){
  return (window.TT_ROLES && window.TT_ROLES[roleKey]) ? window.TT_ROLES[roleKey] : null;
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
   STATE FACTORY
   - Role modules can add their own data in mod.init(state)
   ========================= */
function newState(roleKey){
  var base = {
    version: window.TT_VERSION,
    roleKey: roleKey,

    // shared resources (roles may ignore or repurpose)
    money: 0,
    reputation: 0,
    stage: 0,
    debt: 0,
    demand: 1.0,

    seconds: 0,
    dayCount: 0, // roles can use this or ignore it

    unlocked: {},

    // UI status
    notice: { text:"", type:"" },

    // log
    logLines: []
  };

  var mod = getRoleModule(roleKey);
  if(mod && typeof mod.init === "function"){
    try { mod.init(base); } catch(e){ console.error(e); }
  }

  return base;
}

/* =========================
   BUTTON DISPATCH
   - Index.html calls these by id onclick=""
   - They forward to the active role module if implemented
   ========================= */
function onAction(actionName){
  if(!s) return;

  var mod = getRoleModule(s.roleKey);
  if(mod && typeof mod[actionName] === "function"){
    mod[actionName](s, TT_API);
    render();
    saveGame(true);
    return;
  }

  // no-op if role doesn't implement it yet
  log("Nothing happens. (This role doesn’t implement: " + actionName + ")");
  setNotice("That action isn't available for this role yet.", "red");
  render();
}

function serveCustomer(){ onAction("serve"); }     // Sell / Serve
function doGoodDeed(){ onAction("discount"); }     // Discount / Help
function advertise(){ onAction("advertise"); }
function takeLoan(){ onAction("loan"); }
function repayLoan(){ onAction("repay"); }
function buyUpgrade(which){ onAction("upgrade_" + which); }

/* =========================
   CORE LOOP
   - Calls role.tick() if present
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

  s.seconds += 1;

  var mod = getRoleModule(s.roleKey);
  if(mod && typeof mod.tick === "function"){
    mod.tick(s, TT_API);
  }

  // autosave
  if(s.seconds % 15 === 0) saveGame(true);

  render();
}

/* =========================
   ASCII RENDER (optional)
   - Role modules can fill TT_ASCII, or handle their own UI.
   ========================= */
function renderAscii(){
  var art = $("ascii_display");
  var cap = $("ascii_caption");
  if(!art || !cap || !s) return;

  // role modules can provide a function for ascii
  var mod = getRoleModule(s.roleKey);
  if(mod && typeof mod.getAscii === "function"){
    var out = mod.getAscii(s, TT_API) || { art:"", caption:"" };
    art.textContent = out.art || "";
    cap.textContent = out.caption || "";
    if(out.art) show("ascii_display"); else hide("ascii_display");
    return;
  }

  // fallback: empty
  art.textContent = "";
  cap.textContent = "";
  hide("ascii_display");
}

/* =========================
   RENDER CORE UI
   - Role modules can provide extra lines via mod.renderExtra()
   ========================= */
function render(){
  if(!s) return;

  // main lines
  setHTML("role_line", "<b>Role:</b> " + roleName(s.roleKey));
  setHTML("money_line", "<b>Money:</b> " + money(s.money) + " <span class='muted'>(Debt: " + money(s.debt) + ")</span>");
  setHTML("rep_line", "<b>Reputation:</b> " + s.reputation);
  setHTML("stage_line", "<b>Business:</b> Stage " + (s.stage + 1));
  setHTML("income_line", "<b>Status:</b> Demand x" + (s.demand || 1).toFixed(2));

  // story line + notices
  var baseStory = roleIntro(s.roleKey);

  var mod = getRoleModule(s.roleKey);
  if(mod && typeof mod.story === "function"){
    baseStory = mod.story(s, TT_API) || baseStory;
  }

  var n = notice.text ? notice : (s.notice || {text:"", type:""});
  var noticeHtml = "";
  if(n && n.text){
    if(n.type === "yellow") noticeHtml = "<span class='notice-yellow'>" + n.text + "</span><br/><br/>";
    else if(n.type === "red") noticeHtml = "<span class='notice-red'>" + n.text + "</span><br/><br/>";
    else noticeHtml = n.text + "<br/><br/>";
  }
  setHTML("story_line", noticeHtml + baseStory);

  // visibility: after start, always show core lines
  show("role_line");
  show("money_line");
  show("rep_line");
  show("stage_line");
  show("income_line");
  show("story_line");
  show("log");

  // let role decide which buttons are visible
  applyButtonPolicy();

  // optional: role extra render
  if(mod && typeof mod.renderExtra === "function"){
    mod.renderExtra(s, TT_API);
  }

  renderAscii();
  renderLog();
}

/* =========================
   BUTTON VISIBILITY POLICY
   - Roles tell the engine what to show
   ========================= */
function applyButtonPolicy(){
  // default: hide everything
  hide("serveBtn");
  hide("goodDeedBtn");
  hide("advertiseBtn");
  hide("loanBtn");
  hide("repayBtn");
  hide("upgrade_block");
  hide("upgradeToStallBtn");
  hide("upgradeToStoreBtn");
  hide("hireHelpBtn");
  hide("unlockNewsBtn");

  var mod = getRoleModule(s.roleKey);
  if(mod && typeof mod.buttons === "function"){
    var b = mod.buttons(s, TT_API) || {};
    // expected shape:
    // { serve:true, discount:true, advertise:false, loan:false, repay:false,
    //   upgrades: { stall:false, storefront:false, helper:false, newspaper:false } }

    if(b.serve) show("serveBtn");
    if(b.discount) show("goodDeedBtn");
    if(b.advertise) show("advertiseBtn");
    if(b.loan) show("loanBtn");
    if(b.repay) show("repayBtn");

    if(b.upgrades){
      show("upgrade_block");
      if(b.upgrades.stall) show("upgradeToStallBtn");
      if(b.upgrades.storefront) show("upgradeToStoreBtn");
      if(b.upgrades.helper) show("hireHelpBtn");
      if(b.upgrades.newspaper) show("unlockNewsBtn");
    }
    return;
  }

  // if role isn't implemented yet, allow nothing
}

/* =========================
   ROLE-FACING API (stable)
   - Role modules use this; you won't change this later
   ========================= */
var TT_API = {
  // UI + helpers
  $, show, hide, setHTML, setText, money, clamp, setNotice, log,

  // persistence
  save: function(){ saveGame(true); },

  // random helpers
  rand: function(){ return Math.random(); },

  // staged unlock bag
  unlock: function(key){ s.unlocked[key] = true; },
  isUnlocked: function(key){ return !!s.unlocked[key]; }
};

/* =========================
   START GAME
   ========================= */
function populateRoleDropdown(){
  var sel = $("roleSelect");
  if(!sel) return;

  // if the html already has options, we won't overwrite (safe)
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

  // allow role to run start hook
  var mod = getRoleModule(roleKey);
  if(mod && typeof mod.start === "function"){
    mod.start(s, TT_API);
  } else {
    // reasonable defaults if role isn't implemented yet
    s.money = 100;
    s.reputation = 0;
    setNotice("This role isn’t implemented yet. Try General Store once it exists.", "red");
    log("Role module not found for: " + roleKey);
  }

  render();
  startLoop();
  saveGame(true);
}

/* =========================
   SAVE / LOAD / RESTART
   ========================= */
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

    // let role repair/upgrade old saves
    var mod = getRoleModule(s.roleKey);
    if(mod && typeof mod.onLoad === "function"){
      mod.onLoad(s, TT_API);
    }

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

/* =========================
   INIT
   ========================= */
(function init(){
  populateRoleDropdown();

  // show save presence
  var raw = localStorage.getItem(SAVE_KEY);
  if(raw) setText("saveStatus", "Save found on this device.");

  // keep things clean before start
  hide("role_line");
  hide("money_line");
  hide("rep_line");
  hide("stage_line");
  hide("income_line");
  hide("story_line");
  hide("log");

  hide("serveBtn");
  hide("goodDeedBtn");
  hide("advertiseBtn");
  hide("loanBtn");
  hide("repayBtn");
  hide("upgrade_block");
})();

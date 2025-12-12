/* =========================================================
   roles/general_store.js
   - Plugs into game.js CORE via TT_ROLES["general_store"]
   ========================================================= */

(function(){
  if(!window.TT_ROLES) window.TT_ROLES = {};

  /* -------------------------
     Config
  -------------------------- */
  var START_MONEY = 200;
  var START_REP = 0;

  // time: 1 day = 60 seconds (easy testing)
  var DAY_SECONDS = 60;
  var WEEK_DAYS = 7;

  // upgrades (realistic / harder)
  var COST_CART_TO_STALL = 1500;
  var COST_STALL_TO_STOREFRONT = 12000;

  // Gazette support
  var GAZETTE_SUPPORT_COST = 200;

  // Advertising costs
  function adCost(stage){ return 35 + stage * 20; } // scales

  // Bank
  var LOAN_CASH = 200;
  var LOAN_DEBT = 220;        // 10% up-front add
  var REPAY_STEP = 10;

  // Interest
  var INTEREST_EVERY_SECONDS = 12;
  var INTEREST_RATE = 0.02;

  // Pricing / gameplay
  var EVENT_CHANCE_FAIR = 0.18;
  var RESTOCK_DEFAULT_QTY = 10;

  var ITEMS = [
    { key:"apples",  name:"Apples",      buyIn: 40,  unitCost:1, startStock:25, low:2, fairMin:3, fairMax:5, high:6 },
    { key:"candles", name:"Candles",     buyIn: 60,  unitCost:2, startStock:20, low:3, fairMin:4, fairMax:7, high:9 },
    { key:"flour",   name:"Flour Sacks", buyIn: 80,  unitCost:3, startStock:18, low:4, fairMin:6, fairMax:9, high:12 },
    { key:"cloth",   name:"Cloth Rolls", buyIn:110,  unitCost:5, startStock:14, low:7, fairMin:10,fairMax:14,high:18 }
  ];

  function rentForStage(stage){
    if(stage === 1) return 120; // market fees + permit
    if(stage === 2) return 650; // lease + taxes
    return 0;                   // cart
  }

  function itemDef(st){
    var k = st.gs.itemKey;
    for(var i=0;i<ITEMS.length;i++) if(ITEMS[i].key === k) return ITEMS[i];
    return null;
  }

  function pricingHint(def){
    return (
      "Pricing guide for " + def.name + ":\n" +
      "- Too low: ≤ $" + def.low + "\n" +
      "- Fair: $" + def.fairMin + " to $" + def.fairMax + "\n" +
      "- Too high: ≥ $" + def.high
    );
  }

  /* -------------------------
     Talk events
  -------------------------- */
  function talkEvent(api){
    var events = [
      {
        who: "A tired mother",
        open: "“Please… my kid’s been coughing all night. Do you have anything affordable?”",
        choices: [
          "1) “I can knock a little off. Let’s get you through the week.”",
          "2) “Sorry. Prices are posted.”",
          "3) “Not my problem.”"
        ],
        correct: "1",
        good: "She exhales like she’s been holding her breath all day. “Thank you… seriously.”",
        bad: "Her face drops. People nearby hear the tone and stare.",
        repGood: 3,
        repBad: -2
      },
      {
        who: "A miner",
        open: "He squints at your price. “Feels like you’re squeezing folks.”",
        choices: [
          "1) Explain your costs: supply runs, spoilage, and risk",
          "2) “Pay it or leave.”",
          "3) Laugh and tell him to stop whining"
        ],
        correct: "1",
        good: "He nods slowly. “Alright… I get it. Didn’t think about the supply runs.”",
        bad: "He mutters your name loud enough for others to hear. “Greedy.”",
        repGood: 2,
        repBad: -2
      },
      {
        who: "A regular customer",
        open: "“Can you hold one for me until tomorrow? I get paid then.”",
        choices: [
          "1) “Yeah. I’ll set it aside.”",
          "2) “No holds.”",
          "3) “Double the price and maybe.”"
        ],
        correct: "1",
        good: "They smile. “You’re good people. I’ll tell my cousin to shop here too.”",
        bad: "They walk off, annoyed. “Guess I’ll go elsewhere.”",
        repGood: 2,
        repBad: -1
      }
    ];

    var ev = events[Math.floor(Math.random()*events.length)];

    var promptText =
      ev.who + " says:\n" +
      ev.open + "\n\n" +
      ev.choices.join("\n") + "\n\n" +
      "Type 1, 2, or 3:";

    var ans = prompt(promptText, ev.correct);
    if(ans === null) ans = "";
    ans = String(ans).trim();

    if(ans === ev.correct){
      alert(ev.good);
      return ev.repGood;
    } else {
      alert(ev.bad);
      return ev.repBad;
    }
  }

  /* -------------------------
     Setup flows
  -------------------------- */
  function pickItemFlow(st, api){
    var choices = "Choose what to sell:\n";
    for(var i=0;i<ITEMS.length;i++){
      var it = ITEMS[i];
      choices += (i+1) + ") " + it.name +
        " (Buy-in " + api.money(it.buyIn) + ", Restock " + api.money(it.unitCost) + "/each)\n";
    }

    var raw = prompt(choices, "1");
    if(raw === null) return false;

    var idx = parseInt(raw, 10) - 1;
    if(isNaN(idx) || idx < 0 || idx >= ITEMS.length){
      alert("Please type 1, 2, 3, or 4.");
      return pickItemFlow(st, api);
    }

    var item = ITEMS[idx];
    if(st.money < item.buyIn){
      alert("You don't have enough for that buy-in. Pick a cheaper item or restart.");
      return pickItemFlow(st, api);
    }

    st.money -= item.buyIn;

    st.gs.itemKey = item.key;
    st.gs.itemName = item.name;
    st.gs.unitCost = item.unitCost;
    st.gs.stock = item.startStock;

    st.gs.sellPrice = 0;
    st.gs.nextDiscount = 0;

    api.log("You chose to sell " + item.name + ". Buy-in paid: " + api.money(item.buyIn) + ".");
    return true;
  }

  function setPriceFlow(st, api){
    var def = itemDef(st);
    if(!def) return false;

    var raw = prompt(
      "Set your selling price for " + def.name + " (whole dollars).\n\n" +
      pricingHint(def) + "\n\n" +
      "Type a number like 4:",
      String(def.fairMin)
    );

    if(raw === null) return false;

    var p = parseInt(raw, 10);
    if(isNaN(p) || p <= 0){
      alert("Please type a whole dollar amount (example: 4).");
      return setPriceFlow(st, api);
    }

    st.gs.sellPrice = p;
    api.log("You set your price: " + def.name + " for " + api.money(p) + ".");
    return true;
  }

  /* -------------------------
     Core mechanics
  -------------------------- */
  function onNewDay(st, api){
    st.dayCount += 1;

    // weekly rent only for stall/storefront
    var weekly = rentForStage(st.stage);
    if(weekly <= 0) return;

    if(st.dayCount >= st.gs.nextRentDueDay){
      if(st.money >= weekly){
        st.money -= weekly;
        st.gs.missedRent = 0;
        st.gs.nextRentDueDay += WEEK_DAYS;
        api.log("Weekly rent paid: -" + api.money(weekly) + ".");
        api.setNotice("Weekly rent paid.", "yellow");
      } else {
        st.gs.missedRent = (st.gs.missedRent || 0) + 1;
        st.reputation = api.clamp(st.reputation - 3, -100, 100);
        st.demand = api.clamp(st.demand - 0.04, 0.85, 1.20);
        st.gs.nextRentDueDay += WEEK_DAYS;

        api.log("You couldn't pay weekly rent (" + api.money(weekly) + ").");
        api.setNotice("MISSED RENT: rep + demand dropping.", "red");
      }
    }
  }

  function applyInterest(st, api){
    if(!st.unlocked.bank) return;
    if(st.debt <= 0) return;

    if(st.seconds % INTEREST_EVERY_SECONDS === 0){
      var interest = Math.max(1, Math.floor(st.debt * INTEREST_RATE));
      st.debt += interest;
      api.log("Bank interest increased your debt by " + api.money(interest) + ".");
      if(st.debt >= 350){
        api.setNotice("WARNING: Your debt is getting dangerous.", "red");
      }
    }
  }

  function checkUnlocks(st, api){
    // Stall unlock (harder)
    if(!st.unlocked.stall && (st.gs.totalSales >= 80 && st.money >= (COST_CART_TO_STALL * 0.35))){
      st.unlocked.stall = true;
      api.log("You could apply for a market permit… if you can afford it.");
      api.setNotice("NEW UPGRADE: Cart → Market Stall", "yellow");
    }

    // Storefront unlock (harder)
    if(!st.unlocked.storefront && (st.gs.totalSales >= 260 && st.reputation >= 10 && st.money >= (COST_STALL_TO_STOREFRONT * 0.20))){
      st.unlocked.storefront = true;
      api.log("A storefront is available… but it’s expensive and comes with weekly costs.");
      api.setNotice("NEW UPGRADE: Stall → Storefront", "yellow");
    }

    // Gazette offer appears after stall + some reputation
    if(!st.unlocked.gazetteOffer && (st.stage >= 1 && st.reputation >= 8)){
      st.unlocked.gazetteOffer = true;
      api.log("The Town Gazette offers a feature… for a price.");
      api.setNotice("NEW OPTION: Support the Town Gazette", "yellow");
    }

    // Bank unlock after stall + some money
    if(!st.unlocked.bank && (st.stage >= 1 && st.money >= 500)){
      st.unlocked.bank = true;
      api.log("The bank clerk finally takes you seriously.");
      api.setNotice("NEW RISK: Bank loans unlocked.", "red");
    }
  }

  /* -------------------------
     SELL logic (your loop)
  -------------------------- */
  function sellOnce(st, api){
    if(!st.gs.itemName){
      api.setNotice("Pick an item to sell first.", "red");
      return;
    }

    if(st.gs.stock <= 0){
      api.log("You’re out of stock. Restock before selling.");
      api.setNotice("Out of stock.", "red");
      return;
    }

    var def = itemDef(st);
    var price = st.gs.sellPrice || 0;
    if(price <= 0){
      api.setNotice("Set a price first.", "red");
      return;
    }

    // apply next discount (only for this sale)
    var discount = st.gs.nextDiscount || 0;
    st.gs.nextDiscount = 0;

    var finalPrice = Math.max(0, price - discount);

    // stock down, money up
    st.gs.stock -= 1;
    st.money += finalPrice;

    st.gs.totalSales += 1;

    // Reputation rules based on price band
    var repDelta = 0;

    if(def){
      if(price >= def.high){
        // too high: ALWAYS upset
        repDelta = -2;
        api.log("Customer upset: price felt too high.");
        api.setNotice("Too expensive. Complaints are guaranteed.", "red");
      } else if(price <= def.low){
        // too low: big rep, but weak growth
        repDelta = +3;
        api.log("Customer thrilled: bargain pricing.");
        api.setNotice("Cheap prices: great rep, slow growth.", "yellow");
      } else if(price >= def.fairMin && price <= def.fairMax){
        // fair: mostly neutral/positive, plus talk events sometimes
        repDelta = (Math.random() < 0.55) ? +1 : 0;

        if(Math.random() < EVENT_CHANCE_FAIR){
          var talkDelta = talkEvent(api);
          st.reputation = api.clamp(st.reputation + talkDelta, -100, 100);

          if(talkDelta > 0){
            api.log("You handled the conversation well. +" + talkDelta + " reputation.");
            api.setNotice("Good talk: reputation increased.", "yellow");
          } else {
            api.log("That conversation went badly. " + talkDelta + " reputation.");
            api.setNotice("Bad talk: reputation dropped.", "red");
          }

          // after talk event, stop here (already applied)
          return;
        }
      } else {
        // slightly high but not always angry
        repDelta = (Math.random() < 0.60) ? -1 : 0;
      }
    }

    // Apply rep delta
    if(repDelta !== 0){
      st.reputation = api.clamp(st.reputation + repDelta, -100, 100);
      if(repDelta > 0) api.log("Reputation improved. +" + repDelta + " rep.");
      else api.log("Reputation dropped. " + repDelta + " rep.");
    } else {
      api.log("Sale completed. No major reaction.");
    }

    // Track “danger” moments
    if(def && st.money < def.unitCost * RESTOCK_DEFAULT_QTY && st.gs.stock <= 3){
      api.setNotice("Low stock + low cash: restock will be hard.", "red");
    }

    if(discount > 0){
      api.log("You discounted the sale by " + api.money(discount) + ".");
    }
  }

  /* -------------------------
     Discount logic (choose amount)
  -------------------------- */
  function chooseDiscount(st, api){
    if(!st.gs.itemName){
      api.setNotice("Pick an item to sell first.", "red");
      return;
    }

    var raw = prompt(
      "How much discount (in dollars) should apply to your NEXT sale?\n" +
      "(This comes out of your profit.)",
      "1"
    );
    if(raw === null) return;

    var d = parseInt(raw, 10);
    if(isNaN(d) || d <= 0){
      alert("Type a whole number like 1 or 2.");
      return;
    }

    d = Math.min(d, st.gs.sellPrice || d);
    st.gs.nextDiscount = d;

    // your “base end” stays simple: rep +2 baseline
    // plus a tiny reward for bigger discount, but capped
    var repGain = api.clamp(2 + Math.floor(d / 3), 2, 4);
    st.reputation = api.clamp(st.reputation + repGain, -100, 100);

    api.log("Discount set: -" + api.money(d) + " on next sale. +" + repGain + " reputation.");
    api.setNotice("Discount will apply to the next customer.", "yellow");
  }

  /* -------------------------
     Restock
  -------------------------- */
  function restock(st, api){
    if(!st.gs.itemName){
      api.setNotice("Pick an item to sell first.", "red");
      return;
    }

    var raw = prompt(
      "How many " + st.gs.itemName + " do you want to restock?\n" +
      "Cost: " + api.money(st.gs.unitCost) + " each",
      String(RESTOCK_DEFAULT_QTY)
    );
    if(raw === null) return;

    var qty = parseInt(raw, 10);
    if(isNaN(qty) || qty <= 0){
      alert("Type a whole number like 10.");
      return;
    }

    var total = qty * st.gs.unitCost;
    if(st.money < total){
      api.log("Not enough money to restock that many. Need " + api.money(total) + ".");
      api.setNotice("Not enough cash to restock.", "red");
      return;
    }

    st.money -= total;
    st.gs.stock += qty;

    api.log("Restocked +" + qty + " " + st.gs.itemName + " for " + api.money(total) + ".");
    api.setNotice("Stock refilled.", "yellow");
  }

  /* -------------------------
     Upgrade handlers
  -------------------------- */
  function upgradeStall(st, api){
    if(st.stage >= 1){ api.log("You already have a stall or better."); return; }
    if(st.money < COST_CART_TO_STALL){ api.log("You need " + api.money(COST_CART_TO_STALL) + " to upgrade."); api.setNotice("Need more money for the stall.", "red"); return; }

    st.money -= COST_CART_TO_STALL;
    st.stage = 1;
    st.gs.nextRentDueDay = st.dayCount + WEEK_DAYS;

    api.log("Upgrade complete: Cart → Market Stall.");
    api.log("Weekly rent will be due every " + WEEK_DAYS + " days.");
    api.setNotice("Upgrade purchased. Weekly rent starts now.", "yellow");
  }

  function upgradeStorefront(st, api){
    if(st.stage >= 2){ api.log("You already have a storefront."); return; }
    if(st.stage < 1){ api.log("You need the stall first."); api.setNotice("You need a stall first.", "red"); return; }
    if(st.money < COST_STALL_TO_STOREFRONT){ api.log("You need " + api.money(COST_STALL_TO_STOREFRONT) + " to upgrade."); api.setNotice("Need more money for storefront.", "red"); return; }

    st.money -= COST_STALL_TO_STOREFRONT;
    st.stage = 2;
    st.gs.nextRentDueDay = st.dayCount + WEEK_DAYS;

    api.log("Upgrade complete: Stall → Storefront.");
    api.log("Weekly rent is higher in a storefront.");
    api.setNotice("Upgrade purchased. Higher weekly costs.", "yellow");
  }

  function supportGazette(st, api){
    if(!st.unlocked.gazetteOffer){ api.log("You haven't met the Gazette yet."); return; }
    if(st.gs.gazetteSupported){ api.log("You already support the Gazette."); return; }
    if(st.money < GAZETTE_SUPPORT_COST){ api.log("You need " + api.money(GAZETTE_SUPPORT_COST) + " to support the Gazette."); api.setNotice("Need more money.", "red"); return; }

    st.money -= GAZETTE_SUPPORT_COST;
    st.gs.gazetteSupported = true;
    st.reputation = api.clamp(st.reputation + 3, -100, 100);

    api.log("The Gazette features your business. Advertising unlocked.");
    api.setNotice("Unlocked: advertising.", "yellow");
  }

  /* -------------------------
     Bank
  -------------------------- */
  function loan(st, api){
    if(!st.unlocked.bank){
      api.log("No bank available yet.");
      api.setNotice("Bank not unlocked yet.", "red");
      return;
    }

    st.money += LOAN_CASH;
    st.debt += LOAN_DEBT;

    api.log("You took a bank loan: +" + api.money(LOAN_CASH) + ". Debt increased by " + api.money(LOAN_DEBT) + ".");
    api.setNotice("Loan taken. Debt grows with interest.", "red");
  }

  function repay(st, api){
    if(st.debt <= 0){
      api.log("You have no debt.");
      api.setNotice("No debt to repay.", "yellow");
      return;
    }

    var pay = Math.min(REPAY_STEP, st.debt);
    if(st.money < pay){
      api.log("You don't have enough money to repay right now.");
      api.setNotice("Not enough money to repay.", "red");
      return;
    }

    st.money -= pay;
    st.debt -= pay;

    api.log("You repaid " + api.money(pay) + " of your debt.");
    api.setNotice("Debt reduced.", "yellow");
  }

  /* -------------------------
     Role module registration
  -------------------------- */
  window.TT_ROLES["general_store"] = {

    meta: {
      name: "General Store / Trading Post",
      intro: "You open with a cart and some cash. Your whole future depends on smart pricing and steady stock."
    },

    init: function(st){
      st.money = START_MONEY;
      st.reputation = START_REP;
      st.stage = 0;
      st.debt = 0;
      st.demand = 1.0;

      st.seconds = 0;
      st.dayCount = 0;

      st.unlocked = st.unlocked || {};
      st.unlocked.stall = false;
      st.unlocked.storefront = false;
      st.unlocked.gazetteOffer = false;
      st.unlocked.bank = false;

      st.gs = {
        itemKey: null,
        itemName: "",
        unitCost: 0,
        stock: 0,
        sellPrice: 0,
        nextDiscount: 0,
        nextRentDueDay: WEEK_DAYS,
        missedRent: 0,
        totalSales: 0,
        gazetteSupported: false
      };
    },

    start: function(st, api){
      api.setNotice("You opened with a cart. Choose what you’ll sell.", "yellow");
      api.log("You open your cart. No sales yet.");

      // pick item and price
      var ok1 = pickItemFlow(st, api);
      if(!ok1){
        api.setNotice("Item selection cancelled. Pick an item when you're ready.", "red");
        return;
      }

      var ok2 = setPriceFlow(st, api);
      if(!ok2){
        api.setNotice("Price selection cancelled. Set your price when you're ready.", "red");
        return;
      }

      api.setNotice("Ready. Sell your first item.", "yellow");
      api.log("Stock: " + st.gs.stock + " " + st.gs.itemName + ".");
    },

    tick: function(st, api){
      // no passive income
      // day progression (rent)
      if(st.seconds % DAY_SECONDS === 0){
        onNewDay(st, api);
      }

      applyInterest(st, api);
      checkUnlocks(st, api);
    },

    // Buttons visibility
    buttons: function(st, api){
      var b = {
        serve: !!st.gs.itemName,
        discount: !!st.gs.itemName,
        advertise: st.gs.gazetteSupported === true,
        loan: st.unlocked.bank === true,
        repay: st.unlocked.bank === true,
        upgrades: {
          stall: (st.unlocked.stall === true && st.stage === 0),
          storefront: (st.unlocked.storefront === true && st.stage === 1),
          helper: false,
          newspaper: (st.unlocked.gazetteOffer === true && st.gs.gazetteSupported !== true)
        }
      };
      return b;
    },

    // Story text
    story: function(st, api){
      if(!st.gs.itemName){
        return "You’ve got a cart and some cash… but nothing to sell yet.";
      }

      if(st.stage === 0){
        return "Your cart lives or dies by pricing. Keep stock. Learn what the town tolerates.";
      } else if(st.stage === 1){
        return "A stall brings more eyes… and weekly costs. Miss rent and the town turns on you.";
      } else {
        return "A storefront makes you real. Higher rent, bigger expectations, and more risk.";
      }
    },

    // Actions
    serve: function(st, api){
      sellOnce(st, api);
    },

    discount: function(st, api){
      chooseDiscount(st, api);
    },

    advertise: function(st, api){
      if(!st.gs.gazetteSupported){
        api.log("You need Gazette support before you can advertise.");
        api.setNotice("Support the Gazette first.", "red");
        return;
      }

      var cost = adCost(st.stage);
      if(st.money < cost){
        api.log("Advertising costs money. You don't have enough.");
        api.setNotice("Not enough money to advertise.", "red");
        return;
      }

      st.money -= cost;
      st.demand = api.clamp(st.demand + 0.06, 0.85, 1.20);
      api.log("You ran an advertisement in the Gazette. Demand increased a bit.");
      api.setNotice("Advertising worked.", "yellow");
    },

    loan: function(st, api){ loan(st, api); },
    repay: function(st, api){ repay(st, api); },

    // Upgrades are dispatched as upgrade_stall / upgrade_storefront / upgrade_newspaper
    upgrade_stall: function(st, api){ upgradeStall(st, api); },
    upgrade_storefront: function(st, api){ upgradeStorefront(st, api); },
    upgrade_newspaper: function(st, api){ supportGazette(st, api); },

    // ASCII (optional; if you have ASCII_ART in ascii.js you can ignore this)
    getAscii: function(st, api){
      // If you already have ASCII_ART and want to use it, just return empty and let ascii.js handle it later.
      // For now, keep it simple:
      var cap = "";
      if(st.gs.itemName) cap = "Selling: " + st.gs.itemName + " | Stock: " + st.gs.stock + " | Price: " + api.money(st.gs.sellPrice);
      else cap = "Pick an item to start selling.";
      return { art: "", caption: cap };
    },

    // Extra rendering hook (optional)
    renderExtra: function(st, api){
      // Update button labels to match your wording
      if(api.$("serveBtn") && st.gs.itemName){
        api.$("serveBtn").textContent = "Sell (" + st.gs.itemName + ")";
      }
      if(api.$("goodDeedBtn")){
        api.$("goodDeedBtn").textContent = "Offer discount…";
      }
      if(api.$("loanBtn")){
        api.$("loanBtn").textContent = "Take a small bank loan (" + api.money(LOAN_CASH) + ")";
      }
      if(api.$("repayBtn")){
        api.$("repayBtn").textContent = "Repay debt (" + api.money(REPAY_STEP) + ")";
      }
      if(api.$("advertiseBtn")){
        api.$("advertiseBtn").textContent = "Run a small advertisement (" + api.money(adCost(st.stage)) + ")";
      }
      if(api.$("upgradeToStallBtn")){
        api.$("upgradeToStallBtn").textContent = "Upgrade: Cart → Stall (" + api.money(COST_CART_TO_STALL) + ")";
      }
      if(api.$("upgradeToStoreBtn")){
        api.$("upgradeToStoreBtn").textContent = "Upgrade: Stall → Storefront (" + api.money(COST_STALL_TO_STOREFRONT) + ")";
      }
      if(api.$("unlockNewsBtn")){
        api.$("unlockNewsBtn").textContent = "Support the Town Gazette (" + api.money(GAZETTE_SUPPORT_COST) + ")";
      }

      // Add a Restock button (without changing index.html)
      ensureRestockButton(st, api);
    },

    onLoad: function(st, api){
      // save-compat safety
      st.gs = st.gs || {};
      st.gs.totalSales = st.gs.totalSales || 0;
      st.gs.gazetteSupported = !!st.gs.gazetteSupported;
      st.unlocked = st.unlocked || {};
    }
  };

  /* -------------------------
     Restock button injector
     (keeps index.html untouched)
  -------------------------- */
  function ensureRestockButton(st, api){
    if(api.$("restockBtn")) return;

    var serveBtn = api.$("serveBtn");
    if(!serveBtn) return;

    var btn = document.createElement("button");
    btn.id = "restockBtn";
    btn.className = "home_button";
    btn.textContent = "Restock inventory";
    btn.onclick = function(){ restock(st, api); };

    // insert right after Sell button
    serveBtn.parentNode.insertBefore(btn, serveBtn.nextSibling);

    // label updates after inserted
    btn.textContent = "Restock (" + api.money(st.gs.unitCost) + " each)";
  }

})();


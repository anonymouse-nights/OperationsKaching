/* =========================================================
   roles/general_store.js  (HARD MODE / Oregon Trail vibe)
   - Designed to "teach by losing" with story explanations
   - Works with the CORE game.js you already have (no edits)
   ========================================================= */

(function(){
  if(!window.TT_ROLES) window.TT_ROLES = {};

  /* =========================
     CORE TUNING (Hard)
     ========================= */
  var START_MONEY = 200;
  var START_REP = 0;

  // 1 in-game day = 60 seconds (easy to test)
  var DAY_SECONDS = 60;

  // “Oregon Trail” punishing costs
  var COST_CART_TO_STALL = 2200;
  var COST_STALL_TO_STOREFRONT = 16000;

  // weekly costs hit hard
  var WEEK_DAYS = 7;

  function weeklyRent(stage){
    if(stage === 1) return 180;  // permit + market fee
    if(stage === 2) return 900;  // lease + tax + security
    return 0;                    // cart
  }

  // Gazette
  var GAZETTE_SUPPORT_COST = 260;
  function adCost(stage){ return 55 + stage * 35; }

  // Bank
  var LOAN_CASH = 200;
  var LOAN_DEBT = 220;          // debt starts at 10% extra
  var REPAY_STEP = 10;

  // Interest stays (you said you like it)
  var INTEREST_EVERY_SECONDS = 12;
  var INTEREST_RATE = 0.02;

  // Selling is NOT guaranteed: sometimes no customer shows up
  function customerChance(st){
    // reputation & demand matter, but never 100%
    var rep = st.reputation || 0;       // can go negative
    var base = 0.55;                   // still not guaranteed
    var repBoost = clamp((rep / 100) * 0.25, -0.15, 0.18);
    var demandBoost = clamp(((st.demand || 1) - 1) * 0.40, -0.12, 0.12);
    var stageBoost = (st.stage === 0 ? 0 : (st.stage === 1 ? 0.05 : 0.08));
    return clamp(base + repBoost + demandBoost + stageBoost, 0.30, 0.88);
  }

  // Random events (daily)
  var DAILY_EVENT_CHANCE = 0.30;

  // Pricing bands per item (harder)
  var ITEMS = [
    { key:"apples",  name:"Apples",      buyIn: 60,  unitCost:2,  startStock:12, low:3, fairMin:4, fairMax:6,  high:8  },
    { key:"candles", name:"Candles",     buyIn: 90,  unitCost:3,  startStock:10, low:4, fairMin:6, fairMax:9,  high:12 },
    { key:"flour",   name:"Flour Sacks", buyIn: 130, unitCost:5,  startStock:8,  low:6, fairMin:9, fairMax:13, high:17 },
    { key:"cloth",   name:"Cloth Rolls", buyIn: 180, unitCost:8,  startStock:6,  low:10,fairMin:14,fairMax:19, high:26 }
  ];

  function clamp(n,a,b){ if(n<a) return a; if(n>b) return b; return n; }

  function getItem(st){
    var k = st.gs.itemKey;
    for(var i=0;i<ITEMS.length;i++) if(ITEMS[i].key === k) return ITEMS[i];
    return null;
  }

  /* =========================
     Story / “economics” lines
     ========================= */
  function storyLine(st){
    if(st.gs.dead) return "You’re done. The town moves on without you.";

    if(!st.gs.itemKey) return "A cart with nothing to sell is just wood and silence.";

    if(st.stage === 0){
      return "You’re a cart on a dusty corner. Every price you set teaches the town what you’re worth.";
    }
    if(st.stage === 1){
      return "A stall means more eyes—and more bills. Miss rent and you’ll feel it in the way people look away.";
    }
    return "A storefront makes you real. Real businesses bleed slowly if they grow careless.";
  }

  function econHintOneLiner(st, key){
    // keep it short, like Oregon Trail
    var lines = {
      too_high: "People stop coming when they feel squeezed.",
      too_low: "Crowds don’t pay your bills—profit does.",
      no_stock: "Empty shelves make customers forget you.",
      cashflow: "You’re not broke on paper. You’re broke in timing.",
      rent: "Fixed costs don’t care if it was a slow week.",
      debt: "Debt keeps you alive… then starts eating."
    };
    return lines[key] || "";
  }

  /* =========================
     Popups (minimal, immersive)
     ========================= */
  function pickItemFlow(st, api){
    var text = "Choose what your cart will sell:\n\n";
    for(var i=0;i<ITEMS.length;i++){
      var it = ITEMS[i];
      text += (i+1) + ") " + it.name +
        " (Buy-in " + api.money(it.buyIn) + ", Restock " + api.money(it.unitCost) + " each)\n";
    }
    text += "\n(Type 1-4)";

    var raw = prompt(text, "1");
    if(raw === null) return false;

    var idx = parseInt(raw, 10) - 1;
    if(isNaN(idx) || idx < 0 || idx >= ITEMS.length){
      alert("Pick 1, 2, 3, or 4.");
      return pickItemFlow(st, api);
    }

    var item = ITEMS[idx];
    if(st.money < item.buyIn){
      alert("You don’t have enough for that buy-in. Pick cheaper.");
      return pickItemFlow(st, api);
    }

    st.money -= item.buyIn;

    st.gs.itemKey = item.key;
    st.gs.itemName = item.name;
    st.gs.unitCost = item.unitCost;

    st.gs.stock = item.startStock;

    api.log("You paid " + api.money(item.buyIn) + " to get started selling " + item.name + ".");
    api.setNotice("You chose " + item.name + ".", "yellow");
    return true;
  }

  function setPriceFlow(st, api, isChange){
    var it = getItem(st);
    if(!it) return false;

    // price-change friction (trust)
    if(isChange){
      // only once per day without penalty
      if(st.gs.lastPriceChangeDay === st.dayCount){
        st.reputation = api.clamp(st.reputation - 2, -100, 100);
        api.log("You changed prices again today. People notice.");
        api.setNotice("Price flipping hurts trust.", "red");
      }
      st.gs.lastPriceChangeDay = st.dayCount;
    }

    var guide =
      "Set your price for " + it.name + " (whole dollars)\n\n" +
      "Too low: ≤ " + api.money(it.low) + "\n" +
      "Fair: " + api.money(it.fairMin) + " to " + api.money(it.fairMax) + "\n" +
      "Too high: ≥ " + api.money(it.high) + "\n\n" +
      "Type a number:";

    var raw = prompt(guide, String(st.gs.sellPrice || it.fairMin));
    if(raw === null) return false;

    var p = parseInt(raw, 10);
    if(isNaN(p) || p <= 0){
      alert("Type a whole number like 6.");
      return setPriceFlow(st, api, isChange);
    }

    st.gs.sellPrice = p;
    api.log("You set your price: " + api.money(p) + ".");
    return true;
  }

  function chooseDiscountFlow(st, api){
    var raw = prompt(
      "Offer a discount for your NEXT sale.\n" +
      "How many dollars off?\n\n" +
      "(This cuts your profit, but helps your name.)",
      "1"
    );
    if(raw === null) return;

    var d = parseInt(raw, 10);
    if(isNaN(d) || d <= 0){
      alert("Type a whole number like 1 or 2.");
      return;
    }

    // cap discount to price
    var maxD = Math.max(0, (st.gs.sellPrice || d));
    d = Math.min(d, maxD);

    st.gs.nextDiscount = d;

    // Your requested baseline: “base end $5, +2 rep”
    // Here: reputation is +2 always, and the discount applies to next sale
    st.reputation = api.clamp(st.reputation + 2, -100, 100);

    api.log("You’ll discount the next sale by " + api.money(d) + ". Reputation +2.");
    api.setNotice("Discount queued for next customer.", "yellow");
  }

  /* =========================
     Supply shipments (scarcity)
     ========================= */
  function restockFlow(st, api){
    if(!st.gs.itemKey){
      api.setNotice("Pick an item to sell first.", "red");
      return;
    }

    var it = getItem(st);
    if(!it) return;

    var raw = prompt(
      "Order more " + it.name + ".\n\n" +
      "Cost: " + api.money(st.gs.unitCost) + " each.\n" +
      "Wagons can be delayed.\n\n" +
      "How many do you order?",
      "10"
    );
    if(raw === null) return;

    var qty = parseInt(raw, 10);
    if(isNaN(qty) || qty <= 0){
      alert("Type a whole number like 10.");
      return;
    }

    // shipping risk: delivery delay + occasional spoilage/shortage
    var baseDays = 1;
    var delay = 0;
    if(Math.random() < 0.30) delay += 1;
    if(Math.random() < 0.12) delay += 2;

    // shortages: you pay for qty, but might receive less (rare)
    var shortage = 0;
    if(Math.random() < 0.10){
      shortage = Math.max(1, Math.floor(qty * 0.20));
    }

    var deliveredQty = Math.max(0, qty - shortage);
    var total = qty * st.gs.unitCost;

    if(st.money < total){
      api.log("You don’t have enough cash for that order. Need " + api.money(total) + ".");
      api.setNotice("Not enough cash to place that order.", "red");
      return;
    }

    st.money -= total;

    var arrivalDay = st.dayCount + baseDays + delay;

    st.gs.shipments.push({
      arrivalDay: arrivalDay,
      orderedQty: qty,
      deliveredQty: deliveredQty,
      shortage: shortage
    });

    api.log("You paid " + api.money(total) + " for a supply order. Wagon ETA: day " + arrivalDay + ".");
    if(delay > 0) api.setNotice("Supply wagon might be late.", "red");
    else api.setNotice("Supply wagon on the way.", "yellow");
  }

  function processShipments(st, api){
    if(!st.gs.shipments || st.gs.shipments.length === 0) return;

    var arrived = [];
    for(var i=0;i<st.gs.shipments.length;i++){
      var sh = st.gs.shipments[i];
      if(sh.arrivalDay <= st.dayCount){
        arrived.push(sh);
      }
    }
    if(arrived.length === 0) return;

    // remove arrived
    st.gs.shipments = st.gs.shipments.filter(function(sh){ return sh.arrivalDay > st.dayCount; });

    // apply deliveries
    for(var j=0;j<arrived.length;j++){
      var sh2 = arrived[j];
      st.gs.stock += sh2.deliveredQty;

      if(sh2.shortage > 0){
        api.log("Supply wagon arrived short. Missing " + sh2.shortage + " units.");
        api.setNotice("Your shipment was short.", "red");
      } else {
        api.log("Supply wagon arrived. +" + sh2.deliveredQty + " stock.");
        api.setNotice("Shipment arrived.", "yellow");
      }
    }
  }

  /* =========================
     Hard daily events
     (short, story-driven)
     ========================= */
  function dailyEvent(st, api){
    var roll = Math.random();

    // events are more likely to happen once you grow
    var stage = st.stage;

    var events = [
      {
        name: "Cold snap",
        apply: function(){
          st.demand = api.clamp(st.demand - 0.06, 0.70, 1.20);
          api.log("A cold snap hits. Folks stay home. The street is quieter.");
          api.setNotice("The town is quieter today.", "red");
        }
      },
      {
        name: "Traveling trader undercuts you",
        apply: function(){
          // demand falls if your price is high
          var it = getItem(st);
          if(it && st.gs.sellPrice >= it.fairMax){
            st.demand = api.clamp(st.demand - 0.08, 0.70, 1.20);
            st.reputation = api.clamp(st.reputation - 1, -100, 100);
            api.log("A traveling trader sells cheaper. People compare you.");
            api.setNotice("Competition stings if you're pricey.", "red");
          } else {
            api.log("A traveling trader passes through. You hold your ground.");
            api.setNotice("Competition passed through.", "yellow");
          }
        }
      },
      {
        name: "Good rumor",
        apply: function(){
          st.reputation = api.clamp(st.reputation + 2, -100, 100);
          st.demand = api.clamp(st.demand + 0.05, 0.70, 1.20);
          api.log("Word spreads: you’re fair. More faces drift your way.");
          api.setNotice("Word spreads about you.", "yellow");
        }
      },
      {
        name: "Bad rumor",
        apply: function(){
          st.reputation = api.clamp(st.reputation - 2, -100, 100);
          st.demand = api.clamp(st.demand - 0.05, 0.70, 1.20);
          api.log("Someone says you gouge. People hesitate at your cart.");
          api.setNotice("Rumors hurt.", "red");
        }
      },
      {
        name: "Market inspector",
        apply: function(){
          if(stage >= 1){
            var fee = 35 + stage * 20;
            if(st.money >= fee){
              st.money -= fee;
              api.log("A market inspector collects fees. -" + api.money(fee) + ".");
              api.setNotice("Fees collected.", "red");
            } else {
              st.reputation = api.clamp(st.reputation - 3, -100, 100);
              api.log("Inspector finds you short. People notice the argument.");
              api.setNotice("Being broke looks bad.", "red");
            }
          } else {
            api.log("An inspector strolls by. You’re small enough to ignore.");
            api.setNotice("", "");
          }
        }
      }
    ];

    // Choose an event with a simple random index
    var ev = events[Math.floor(Math.random() * events.length)];
    ev.apply();
  }

  /* =========================
     Selling (punishing)
     ========================= */
  function sellOnce(st, api){
    if(st.gs.dead) return;

    if(!st.gs.itemKey){
      api.setNotice("Pick an item to sell first.", "red");
      return;
    }

    // sometimes nobody shows up
    if(Math.random() > customerChance(st)){
      api.log("You wait. Nobody buys. The street keeps moving.");
      api.setNotice("No customer right now.", "red");
      return;
    }

    if(st.gs.stock <= 0){
      api.log("A customer looks… then leaves. You have nothing to sell.");
      api.setNotice(econHintOneLiner(st, "no_stock"), "red");
      return;
    }

    var it = getItem(st);
    var price = st.gs.sellPrice || 0;
    if(price <= 0){
      api.setNotice("Set a price first.", "red");
      return;
    }

    // apply queued discount (one sale)
    var discount = st.gs.nextDiscount || 0;
    st.gs.nextDiscount = 0;

    var finalPrice = Math.max(0, price - discount);

    // sell 1 unit
    st.gs.stock -= 1;
    st.money += finalPrice;
    st.gs.totalSales += 1;

    // Price reaction
    var repDelta = 0;

    if(it){
      if(price >= it.high){
        // too high: guaranteed anger
        repDelta = -2;
        st.demand = api.clamp(st.demand - 0.03, 0.70, 1.20);
        api.log("Customer scowls at the price and walks off angry.");
        api.setNotice(econHintOneLiner(st, "too_high"), "red");
      } else if(price <= it.low){
        // too low: people love you, but you bleed growth
        repDelta = +3;
        api.log("Customer grins. “That’s cheap.” Word travels fast.");
        api.setNotice(econHintOneLiner(st, "too_low"), "yellow");
      } else if(price >= it.fairMin && price <= it.fairMax){
        // fair: small random + occasional talk event
        repDelta = (Math.random() < 0.55) ? 1 : 0;

        // talk event chance
        if(Math.random() < 0.20){
          var talk = talkEvent(api);
          st.reputation = api.clamp(st.reputation + talk, -100, 100);
          if(talk > 0){
            api.log("You handled it well. +" + talk + " reputation.");
            api.setNotice("You talk your way through it.", "yellow");
          } else {
            api.log("That went badly. " + talk + " reputation.");
            api.setNotice("Your words cost you.", "red");
          }
          return;
        }
      } else {
        // slightly off: mild negatives sometimes
        repDelta = (Math.random() < 0.50) ? -1 : 0;
      }
    }

    // Apply rep delta
    if(repDelta !== 0){
      st.reputation = api.clamp(st.reputation + repDelta, -100, 100);
      api.log("Reputation " + (repDelta > 0 ? "improved" : "dropped") + " (" + repDelta + ").");
    } else {
      api.log("Sale completed. No strong reaction.");
    }

    // cashflow warnings
    if(it && st.money < (st.gs.unitCost * 8) && st.gs.stock <= 2){
      api.setNotice(econHintOneLiner(st, "cashflow"), "red");
    }
  }

  function talkEvent(api){
    var events = [
      {
        who: "A tired mother",
        open: "“Please… I’m short this week. Help me out?”",
        choices: [
          "1) “Alright. I’ll make it work.”",
          "2) “Prices are posted.”",
          "3) “Not my problem.”"
        ],
        correct: "1",
        good: "She exhales like she’s been holding her breath all day.",
        bad: "Her face drops. People nearby hear the tone.",
        repGood: 3,
        repBad: -2
      },
      {
        who: "A miner",
        open: "“Feels like you’re squeezing folks.”",
        choices: [
          "1) Explain your costs (wagon, spoilage, risk)",
          "2) “Pay it or leave.”",
          "3) Laugh and shrug"
        ],
        correct: "1",
        good: "He nods slowly. “Alright… fair.”",
        bad: "He says your name loud enough for others to hear: “Greedy.”",
        repGood: 2,
        repBad: -2
      },
      {
        who: "A regular",
        open: "“Can you hold one for me till tomorrow?”",
        choices: [
          "1) “Yeah. I’ll set it aside.”",
          "2) “No holds.”",
          "3) “Double the price and maybe.”"
        ],
        correct: "1",
        good: "They smile. “You’re good people.”",
        bad: "They walk off, annoyed: “Guess I’ll go elsewhere.”",
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

  /* =========================
     Bank
     ========================= */
  function takeLoan(st, api){
    if(!st.unlocked.bank){
      api.log("The bank clerk barely looks up. Not yet.");
      api.setNotice("Bank not unlocked yet.", "red");
      return;
    }
    st.money += LOAN_CASH;
    st.debt += LOAN_DEBT;
    api.log("You take a loan: +" + api.money(LOAN_CASH) + ". Debt + " + api.money(LOAN_DEBT) + ".");
    api.setNotice(econHintOneLiner(st, "debt"), "red");
  }

  function repayDebt(st, api){
    if(st.debt <= 0){
      api.log("No debt to repay.");
      api.setNotice("", "");
      return;
    }
    var pay = Math.min(REPAY_STEP, st.debt);
    if(st.money < pay){
      api.log("You fumble for coins. Not enough.");
      api.setNotice("Not enough money to repay.", "red");
      return;
    }
    st.money -= pay;
    st.debt -= pay;
    api.log("You repay " + api.money(pay) + ". Debt now " + api.money(st.debt) + ".");
    api.setNotice("Debt reduced.", "yellow");
  }

  function applyInterest(st, api){
    if(!st.unlocked.bank) return;
    if(st.debt <= 0) return;
    if(st.seconds % INTEREST_EVERY_SECONDS !== 0) return;

    var interest = Math.max(1, Math.floor(st.debt * INTEREST_RATE));
    st.debt += interest;
    api.log("Interest adds " + api.money(interest) + " to your debt.");
    if(st.debt >= 350){
      api.setNotice("Debt is getting dangerous.", "red");
    }
  }

  /* =========================
     Gazette
     ========================= */
  function supportGazette(st, api){
    if(!st.unlocked.gazetteOffer){
      api.log("No Gazette offer yet.");
      return;
    }
    if(st.gs.gazetteSupported){
      api.log("You already paid the Gazette.");
      return;
    }
    if(st.money < GAZETTE_SUPPORT_COST){
      api.log("You can’t afford the Gazette feature.");
      api.setNotice("Need more money.", "red");
      return;
    }

    st.money -= GAZETTE_SUPPORT_COST;
    st.gs.gazetteSupported = true;
    st.reputation = api.clamp(st.reputation + 2, -100, 100);
    st.demand = api.clamp(st.demand + 0.03, 0.70, 1.20);

    api.log("The Gazette prints your name. A few new faces appear.");
    api.setNotice("Advertising unlocked.", "yellow");
  }

  function advertise(st, api){
    if(!st.gs.gazetteSupported){
      api.log("You need the Gazette before you can advertise.");
      api.setNotice("Support the Gazette first.", "red");
      return;
    }
    var cost = adCost(st.stage);
    if(st.money < cost){
      api.log("Advertising costs money. You don’t have enough.");
      api.setNotice("Not enough money to advertise.", "red");
      return;
    }
    st.money -= cost;
    st.demand = api.clamp(st.demand + 0.08, 0.70, 1.20);
    api.log("Your ad runs. More footsteps drift your way.");
    api.setNotice("Demand increased.", "yellow");
  }

  /* =========================
     Upgrades (hard)
     ========================= */
  function upgradeToStall(st, api){
    if(st.stage >= 1){
      api.log("You already have a stall (or better).");
      return;
    }
    if(st.money < COST_CART_TO_STALL){
      api.log("You need " + api.money(COST_CART_TO_STALL) + " for a stall permit + setup.");
      api.setNotice("Not enough money to upgrade.", "red");
      return;
    }

    st.money -= COST_CART_TO_STALL;
    st.stage = 1;

    // rent schedule
    st.gs.nextRentDueDay = st.dayCount + WEEK_DAYS;
    st.gs.missedRent = 0;

    api.log("You step into the market with a stall. Bills follow you in.");
    api.setNotice("Stall purchased. Weekly rent begins.", "yellow");
  }

  function upgradeToStorefront(st, api){
    if(st.stage >= 2){
      api.log("You already have a storefront.");
      return;
    }
    if(st.stage < 1){
      api.log("You need a stall first.");
      api.setNotice("Need a stall first.", "red");
      return;
    }
    if(st.money < COST_STALL_TO_STOREFRONT){
      api.log("You need " + api.money(COST_STALL_TO_STOREFRONT) + " to lease + setup a storefront.");
      api.setNotice("Not enough money to upgrade.", "red");
      return;
    }

    st.money -= COST_STALL_TO_STOREFRONT;
    st.stage = 2;

    st.gs.nextRentDueDay = st.dayCount + WEEK_DAYS;
    st.gs.missedRent = 0;

    api.log("You unlock the storefront door. The town now expects you to last.");
    api.setNotice("Storefront purchased. Higher weekly costs.", "yellow");
  }

  /* =========================
     Rent + Failure states
     ========================= */
  function payRentIfDue(st, api){
    var rent = weeklyRent(st.stage);
    if(rent <= 0) return;

    if(st.dayCount < st.gs.nextRentDueDay) return;

    // due now
    if(st.money >= rent){
      st.money -= rent;
      st.gs.missedRent = 0;
      st.gs.nextRentDueDay += WEEK_DAYS;
      api.log("Rent paid: -" + api.money(rent) + ".");
      api.setNotice(econHintOneLiner(st, "rent"), "yellow");
    } else {
      st.gs.missedRent += 1;
      st.reputation = api.clamp(st.reputation - 3, -100, 100);
      st.demand = api.clamp(st.demand - 0.06, 0.70, 1.20);
      st.gs.nextRentDueDay += WEEK_DAYS;

      api.log("You miss rent. The market board makes a note.");
      api.setNotice("You missed rent. Things get colder.", "red");

      // hard fail after 2 missed rents
      if(st.gs.missedRent >= 2){
        gameOver(st, api, "The market board revokes your permit.\nYour stall is cleared out before sunrise.");
      }
    }
  }

  function bankruptcyCheck(st, api){
    // If you cannot sell (no stock), no cash, and no shipments coming -> done
    var hasIncoming = (st.gs.shipments && st.gs.shipments.length > 0);
    if(st.money <= 0 && st.gs.stock <= 0 && !hasIncoming){
      gameOver(st, api, "You sit behind an empty cart with empty pockets.\nNo supplier will extend you credit.\nYou leave town quietly.");
    }
  }

  function gameOver(st, api, msg){
    if(st.gs.dead) return;
    st.gs.dead = true;

    api.log("—");
    api.log("END: " + msg.replace(/\n/g, " "));
    api.setNotice("You failed. Try again smarter.", "red");

    // Oregon Trail-style end screen
    setTimeout(function(){
      alert(msg + "\n\n(Your run is over.)");
      // Fast restart prompt
      if(confirm("Restart from the beginning?")){
        localStorage.removeItem("townTrade_save_core_v1");
        location.reload();
      }
    }, 50);
  }

  /* =========================
     Unlocks (later + harder)
     ========================= */
  function unlocks(st, api){
    // Stall “available” after proving you can sell + keep some money
    if(!st.unlocked.stall && st.gs.totalSales >= 35 && st.money >= 500){
      st.unlocked.stall = true;
      api.log("A market permit becomes possible… if you can afford it.");
      api.setNotice("NEW UPGRADE: Cart → Stall", "yellow");
    }

    // Storefront after real performance
    if(!st.unlocked.storefront && st.stage >= 1 && st.gs.totalSales >= 180 && st.reputation >= 8 && st.money >= 2600){
      st.unlocked.storefront = true;
      api.log("A storefront lease is posted. The numbers are ugly.");
      api.setNotice("NEW UPGRADE: Stall → Storefront", "yellow");
    }

    // Gazette offer after stall + some rep
    if(!st.unlocked.gazetteOffer && st.stage >= 1 && st.reputation >= 6){
      st.unlocked.gazetteOffer = true;
      api.log("The Town Gazette offers a feature… for a fee.");
      api.setNotice("NEW OPTION: Support the Gazette", "yellow");
    }

    // Bank later (do not show early)
    if(!st.unlocked.bank && st.stage >= 1 && st.money >= 800){
      st.unlocked.bank = true;
      api.log("The bank clerk finally looks up when you walk in.");
      api.setNotice("NEW RISK: Bank loans unlocked.", "red");
    }
  }

  /* =========================
     Day change
     ========================= */
  function onNewDay(st, api){
    st.dayCount += 1;

    // shipments arrive in the morning
    processShipments(st, api);

    // rent check
    payRentIfDue(st, api);

    // daily random event (not every day)
    if(Math.random() < DAILY_EVENT_CHANCE){
      dailyEvent(st, api);
    }

    // tiny demand drift based on reputation (slow, but real)
    var rep = st.reputation || 0;
    var drift = (rep / 100) * 0.015;
    st.demand = api.clamp((st.demand || 1) + drift, 0.70, 1.20);

    // soft daily summary (one sentence)
    if(st.dayCount > 1){
      api.log("Day " + st.dayCount + ": Cash " + api.money(st.money) + ", Stock " + st.gs.stock + ", Rep " + st.reputation + ".");
    }

    bankruptcyCheck(st, api);
  }

  /* =========================
     UI injection (no index edits)
     ========================= */
  function ensureExtraButtons(st, api){
    // Add: Set Price, Restock
    if(!api.$("setPriceBtn")){
      var anchor = api.$("serveBtn") || api.$("goodDeedBtn");
      if(anchor && anchor.parentNode){
        var b1 = document.createElement("button");
        b1.id = "setPriceBtn";
        b1.className = "home_button";
        b1.onclick = function(){
          if(st.gs.dead) return;
          if(!st.gs.itemKey){
            api.setNotice("Pick an item first.", "red");
            return;
          }
          setPriceFlow(st, api, true);
        };
        anchor.parentNode.insertBefore(b1, anchor);
        anchor.parentNode.insertBefore(document.createElement("br"), anchor);
      }
    }

    if(!api.$("restockBtn")){
      var anchor2 = api.$("serveBtn");
      if(anchor2 && anchor2.parentNode){
        var b2 = document.createElement("button");
        b2.id = "restockBtn";
        b2.className = "home_button";
        b2.onclick = function(){
          if(st.gs.dead) return;
          restockFlow(st, api);
        };
        // after sell button
        anchor2.parentNode.insertBefore(document.createElement("br"), anchor2.nextSibling);
        anchor2.parentNode.insertBefore(b2, anchor2.nextSibling);
        anchor2.parentNode.insertBefore(document.createElement("br"), anchor2.nextSibling);
      }
    }
  }

  function updateButtonLabels(st, api){
    var sellBtn = api.$("serveBtn");
    var discBtn = api.$("goodDeedBtn");
    var setBtn = api.$("setPriceBtn");
    var restBtn = api.$("restockBtn");

    if(sellBtn){
      sellBtn.textContent = st.gs.itemName ? ("Sell (" + st.gs.itemName + ")") : "Sell";
    }
    if(discBtn){
      discBtn.textContent = "Offer discount…";
    }
    if(setBtn){
      setBtn.textContent = "Set / Change price";
    }
    if(restBtn){
      restBtn.textContent = st.gs.itemName ? ("Order stock (" + (window.TT && TT.money ? "" : "") + ")") : "Order stock";
      // keep restock label useful
      if(st.gs.itemName){
        restBtn.textContent = "Order stock (" + (api.money(st.gs.unitCost) + " each") + ")";
      } else {
        restBtn.textContent = "Order stock";
      }
    }

    if(api.$("loanBtn")) api.$("loanBtn").textContent = "Take a small bank loan (" + api.money(LOAN_CASH) + ")";
    if(api.$("repayBtn")) api.$("repayBtn").textContent = "Repay debt (" + api.money(REPAY_STEP) + ")";
    if(api.$("advertiseBtn")) api.$("advertiseBtn").textContent = "Run a small advertisement (" + api.money(adCost(st.stage)) + ")";
    if(api.$("upgradeToStallBtn")) api.$("upgradeToStallBtn").textContent = "Upgrade: Cart → Stall (" + api.money(COST_CART_TO_STALL) + ")";
    if(api.$("upgradeToStoreBtn")) api.$("upgradeToStoreBtn").textContent = "Upgrade: Stall → Storefront (" + api.money(COST_STALL_TO_STOREFRONT) + ")";
    if(api.$("unlockNewsBtn")) api.$("unlockNewsBtn").textContent = "Support the Town Gazette (" + api.money(GAZETTE_SUPPORT_COST) + ")";
  }

  /* =========================
     Module Registration
     ========================= */
  window.TT_ROLES["general_store"] = {
    meta: {
      name: "General Store / Trading Post",
      intro: "A cart. A few coins. A town that remembers. You don’t win by being liked—you win by lasting."
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
        dead: false,

        itemKey: null,
        itemName: "",
        unitCost: 0,

        stock: 0,
        sellPrice: 0,
        nextDiscount: 0,

        lastPriceChangeDay: -999,

        shipments: [],

        totalSales: 0,

        gazetteSupported: false,

        nextRentDueDay: WEEK_DAYS,
        missedRent: 0
      };
    },

    start: function(st, api){
      api.setNotice("Open the cart. Choose what you'll sell.", "yellow");
      api.log("You set the cart wheels straight and wait for a first customer.");

      var ok = pickItemFlow(st, api);
      if(!ok){
        api.setNotice("You backed out. Choose an item when you're ready.", "red");
        return;
      }

      var ok2 = setPriceFlow(st, api, false);
      if(!ok2){
        api.setNotice("No price set. You can set it anytime.", "red");
      } else {
        api.setNotice("Ready. Try your first sale.", "yellow");
      }
    },

    tick: function(st, api){
      if(st.gs.dead) return;

      // day tick
      if(st.seconds % DAY_SECONDS === 0){
        onNewDay(st, api);
      }

      // interest tick
      applyInterest(st, api);

      // unlock checks
      unlocks(st, api);

      // small drift: reputational gravity
      if(st.seconds % 10 === 0){
        var rep = st.reputation || 0;
        var drift = (rep / 100) / 90; // slow
        st.demand = api.clamp((st.demand || 1) + drift, 0.70, 1.20);
      }

      bankruptcyCheck(st, api);
    },

    buttons: function(st, api){
      // Only show what becomes available (Oregon Trail style)
      return {
        serve: !!st.gs.itemKey && !st.gs.dead,
        discount: !!st.gs.itemKey && !st.gs.dead,

        // ads only after paying Gazette
        advertise: (st.gs.gazetteSupported === true) && !st.gs.dead,

        // bank only after unlock
        loan: (st.unlocked.bank === true) && !st.gs.dead,
        repay: (st.unlocked.bank === true) && !st.gs.dead,

        upgrades: {
          stall: (st.unlocked.stall === true && st.stage === 0 && !st.gs.dead),
          storefront: (st.unlocked.storefront === true && st.stage === 1 && !st.gs.dead),
          helper: false,
          newspaper: (st.unlocked.gazetteOffer === true && st.gs.gazetteSupported !== true && !st.gs.dead)
        }
      };
    },

    story: function(st, api){
      return storyLine(st);
    },

    // Actions
    serve: function(st, api){ sellOnce(st, api); },
    discount: function(st, api){ chooseDiscountFlow(st, api); },
    advertise: function(st, api){ advertise(st, api); },
    loan: function(st, api){ takeLoan(st, api); },
    repay: function(st, api){ repayDebt(st, api); },

    upgrade_stall: function(st, api){ upgradeToStall(st, api); },
    upgrade_storefront: function(st, api){ upgradeToStorefront(st, api); },
    upgrade_newspaper: function(st, api){ supportGazette(st, api); },

    renderExtra: function(st, api){
      ensureExtraButtons(st, api);
      updateButtonLabels(st, api);

      // Update the discount button to match your original request wording
      if(api.$("goodDeedBtn")) api.$("goodDeedBtn").textContent = "Offer discount…";

      // Add a “status” line into the ASCII caption area (no ascii art required)
      if(api.$("ascii_caption")){
        var incoming = (st.gs.shipments && st.gs.shipments.length) ? st.gs.shipments.length : 0;
        var eta = "";
        if(incoming){
          var soon = st.gs.shipments.reduce(function(min, sh){ return Math.min(min, sh.arrivalDay); }, 999999);
          eta = " | Wagon ETA: day " + soon;
        }

        api.$("ascii_caption").textContent =
          (st.gs.itemName ? ("Selling: " + st.gs.itemName) : "Pick an item to sell") +
          " | Price: " + (st.gs.sellPrice ? api.money(st.gs.sellPrice) : "unset") +
          " | Stock: " + (st.gs.stock || 0) +
          " | Cash: " + api.money(st.money) +
          " | Rep: " + st.reputation +
          eta;
      }
    },

    onLoad: function(st, api){
      // save safety
      st.gs = st.gs || {};
      st.gs.shipments = st.gs.shipments || [];
      st.gs.totalSales = st.gs.totalSales || 0;
      st.gs.missedRent = st.gs.missedRent || 0;
      if(typeof st.gs.gazetteSupported !== "boolean") st.gs.gazetteSupported = !!st.gs.gazetteSupported;
      if(typeof st.gs.dead !== "boolean") st.gs.dead = false;
      if(typeof st.gs.lastPriceChangeDay !== "number") st.gs.lastPriceChangeDay = -999;

      st.unlocked = st.unlocked || {};
      if(typeof st.unlocked.stall !== "boolean") st.unlocked.stall = false;
      if(typeof st.unlocked.storefront !== "boolean") st.unlocked.storefront = false;
      if(typeof st.unlocked.gazetteOffer !== "boolean") st.unlocked.gazetteOffer = false;
      if(typeof st.unlocked.bank !== "boolean") st.unlocked.bank = false;
    }
  };

})();

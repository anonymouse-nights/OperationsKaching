/* =========================================================
   roles/general_store.js  (HARD MODE / Oregon Trail vibe)
   - "Learning by losing" with story explanations
   - Adds directly:
       1) Town migration
       2) Seasons
       3) Competitor storefront
   - Includes price changing after first set (button + penalties)
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

  // Hard upgrade costs
  var COST_CART_TO_STALL = 2200;
  var COST_STALL_TO_STOREFRONT = 16000;

  var WEEK_DAYS = 7;

  function weeklyRent(stage){
    if(stage === 1) return 180;  // permit + market fee
    if(stage === 2) return 900;  // lease + tax + security
    return 0;                    // cart
  }

  // Gazette
  var GAZETTE_SUPPORT_COST = 260;
  function adCost(stage){ return 55 + stage * 35; }

  // Bank (you requested)
  var LOAN_CASH = 200;
  var LOAN_DEBT = 220;          // debt starts at +10% extra
  var REPAY_STEP = 10;

  // Ongoing interest (you kept this)
  var INTEREST_EVERY_SECONDS = 12;
  var INTEREST_RATE = 0.02;

  // Daily event chance
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
     Seasons (added)
     =========================
     60-day "year" loop:
       0-14 Spring
       15-29 Summer
       30-44 Fall
       45-59 Winter
  */
  function seasonName(dayCount){
    var d = (dayCount % 60);
    if(d < 15) return "Spring";
    if(d < 30) return "Summer";
    if(d < 45) return "Fall";
    return "Winter";
  }

  function seasonDemandMultiplier(season){
    if(season === "Spring") return 1.00;
    if(season === "Summer") return 1.04;
    if(season === "Fall")   return 0.98;
    return 0.88; // Winter is brutal
  }

  function applySeasonSideEffects(st, api){
    var it = getItem(st);
    if(!it) return;

    // Summer spoilage: apples can rot if you hoard too long
    if(st.gs.season === "Summer" && it.key === "apples" && st.gs.stock >= 10 && Math.random() < 0.18){
      var lost = Math.max(1, Math.floor(st.gs.stock * 0.20));
      st.gs.stock = Math.max(0, st.gs.stock - lost);
      api.log("Heat spoils some apples. -" + lost + " stock.");
      api.setNotice("Spoilage: heat ruined stock.", "red");
    }

    // Winter slow street: sometimes fewer people show up
    if(st.gs.season === "Winter" && Math.random() < 0.20){
      st.demand = clamp(st.demand - 0.04, 0.70, 1.20);
      api.log("Winter quiets the road. The street feels empty.");
      api.setNotice("Winter slows the town.", "red");
    }
  }

  /* =========================
     Competitor storefront (added)
     ========================= */
  function maybeSpawnCompetitor(st, api){
    if(st.gs.competitorActive) return;
    if(st.stage < 1) return;              // no real competitor until you’re in the market
    if(st.dayCount < 12) return;          // not early
    if(Math.random() < 0.08){             // rare
      st.gs.competitorActive = true;
      st.gs.competitorPressure = 0.06 + Math.random() * 0.08; // 0.06–0.14 demand pressure
      api.log("A new stall opens nearby. People compare prices now.");
      api.setNotice("Competition arrived.", "red");
    }
  }

  function competitorPenalty(st){
    if(!st.gs.competitorActive) return 0;
    var it = getItem(st);
    if(!it) return 0;
    var p = st.gs.sellPrice || 0;

    // If you're overpriced vs fair, competitor hurts you harder
    if(p >= it.fairMax + 2) return st.gs.competitorPressure * 1.4;
    if(p > it.fairMax) return st.gs.competitorPressure * 1.1;
    if(p >= it.fairMin && p <= it.fairMax) return st.gs.competitorPressure * 0.65;
    if(p <= it.low) return st.gs.competitorPressure * 0.35; // cheap keeps people
    return st.gs.competitorPressure * 0.85;
  }

  /* =========================
     Customer chance
     ========================= */
  function customerChance(st){
    var rep = st.reputation || 0;       // can go negative
    var base = 0.55;
    var repBoost = clamp((rep / 100) * 0.25, -0.15, 0.18);
    var demandBoost = clamp(((st.demand || 1) - 1) * 0.40, -0.12, 0.12);
    var stageBoost = (st.stage === 0 ? 0 : (st.stage === 1 ? 0.05 : 0.08));

    // Season multiplier influences traffic
    var seasonMul = seasonDemandMultiplier(st.gs.season || "Spring");
    var seasonAdj = clamp((seasonMul - 1) * 0.55, -0.18, 0.10);

    // Competitor reduces traffic chance
    var comp = competitorPenalty(st);
    var compAdj = clamp(-comp * 1.35, -0.22, 0);

    return clamp(base + repBoost + demandBoost + stageBoost + seasonAdj + compAdj, 0.25, 0.88);
  }

  /* =========================
     Story lines (short, in-world)
     ========================= */
  function storyLine(st){
    if(st.gs.dead) return "You’re done. The town moves on without you.";

    if(!st.gs.itemKey) return "A cart with nothing to sell is just wood and silence.";

    var season = st.gs.season || "Spring";
    var town = "Town #" + (st.gs.townIndex || 1);

    if(st.stage === 0){
      return town + " • " + season + ": You’re a cart on a dusty corner. Every price you set teaches the town what you’re worth.";
    }
    if(st.stage === 1){
      return town + " • " + season + ": A stall means more eyes—and more bills. Miss rent and you’ll feel it in the way people look away.";
    }
    return town + " • " + season + ": A storefront makes you real. Real businesses bleed slowly if they grow careless.";
  }

  function econHintOneLiner(key){
    var lines = {
      too_high: "People stop coming when they feel squeezed.",
      too_low: "Crowds don’t pay your bills—profit does.",
      no_stock: "Empty shelves make customers forget you.",
      cashflow: "You’re not broke on paper. You’re broke in timing.",
      rent: "Fixed costs don’t care if it was a slow week.",
      debt: "Debt keeps you alive… then starts eating.",
      compete: "Competition punishes laziness and bad pricing.",
      travel: "A new town can save you—or finish you."
    };
    return lines[key] || "";
  }

  /* =========================
     Popups
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

    // Price-change trust penalty (hard)
    if(isChange){
      // only one “free” change per day
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
    if(isChange) api.setNotice("Price updated.", "yellow");
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

    var maxD = Math.max(0, (st.gs.sellPrice || d));
    d = Math.min(d, maxD);

    st.gs.nextDiscount = d;

    // Your requested change: base reputation bump +2 (not huge)
    st.reputation = api.clamp(st.reputation + 2, -100, 100);

    api.log("You’ll discount the next sale by " + api.money(d) + ". Reputation +2.");
    api.setNotice("Discount queued for next customer.", "yellow");
  }

  /* =========================
     Restock shipments (scarcity)
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

    var baseDays = 1;
    var delay = 0;
    if(Math.random() < 0.30) delay += 1;
    if(Math.random() < 0.12) delay += 2;

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
    api.setNotice((delay > 0) ? "Supply wagon might be late." : "Supply wagon on the way.", delay > 0 ? "red" : "yellow");
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

    st.gs.shipments = st.gs.shipments.filter(function(sh){ return sh.arrivalDay > st.dayCount; });

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
     Daily events (short)
     ========================= */
  function dailyEvent(st, api){
    var events = [
      function(){
        st.demand = api.clamp(st.demand - 0.06, 0.70, 1.20);
        api.log("A cold snap hits. Folks stay home. The street is quieter.");
        api.setNotice("The town is quieter today.", "red");
      },
      function(){
        var it = getItem(st);
        if(it && st.gs.sellPrice >= it.fairMax){
          st.demand = api.clamp(st.demand - 0.08, 0.70, 1.20);
          st.reputation = api.clamp(st.reputation - 1, -100, 100);
          api.log("A traveling trader sells cheaper. People compare you.");
          api.setNotice("Competition stings if you're pricey.", "red");
        } else {
          api.log("A traveling trader passes through. You hold your ground.");
          api.setNotice("", "");
        }
      },
      function(){
        st.reputation = api.clamp(st.reputation + 2, -100, 100);
        st.demand = api.clamp(st.demand + 0.05, 0.70, 1.20);
        api.log("Word spreads: you’re fair. More faces drift your way.");
        api.setNotice("Word spreads about you.", "yellow");
      },
      function(){
        st.reputation = api.clamp(st.reputation - 2, -100, 100);
        st.demand = api.clamp(st.demand - 0.05, 0.70, 1.20);
        api.log("Someone says you gouge. People hesitate at your cart.");
        api.setNotice("Rumors hurt.", "red");
      }
    ];

    var ev = events[Math.floor(Math.random() * events.length)];
    ev();
  }

  /* =========================
     Talk events (light)
     ========================= */
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
      api.setNotice(econHintOneLiner("no_stock"), "red");
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

    var repDelta = 0;

    if(it){
      if(price >= it.high){
        repDelta = -2;
        st.demand = api.clamp(st.demand - 0.03, 0.70, 1.20);
        api.log("Customer scowls at the price and walks off angry.");
        api.setNotice(econHintOneLiner("too_high"), "red");
      } else if(price <= it.low){
        repDelta = +3;
        api.log("Customer grins. “That’s cheap.” Word travels fast.");
        api.setNotice(econHintOneLiner("too_low"), "yellow");
      } else if(price >= it.fairMin && price <= it.fairMax){
        repDelta = (Math.random() < 0.55) ? 1 : 0;

        if(Math.random() < 0.20){
          var talk = talkEvent(api);
          st.reputation = api.clamp(st.reputation + talk, -100, 100);
          api.log(talk > 0 ? ("You handled it well. +" + talk + " reputation.")
                           : ("That went badly. " + talk + " reputation."));
          api.setNotice(talk > 0 ? "You talk your way through it." : "Your words cost you.", talk > 0 ? "yellow" : "red");
          return;
        }
      } else {
        repDelta = (Math.random() < 0.50) ? -1 : 0;
      }
    }

    if(repDelta !== 0){
      st.reputation = api.clamp(st.reputation + repDelta, -100, 100);
      api.log("Reputation " + (repDelta > 0 ? "improved" : "dropped") + " (" + repDelta + ").");
    } else {
      api.log("Sale completed. No strong reaction.");
    }

    // Competitor sting callout
    if(st.gs.competitorActive && Math.random() < 0.25){
      api.setNotice(econHintOneLiner("compete"), "red");
    }

    // cashflow warning
    if(it && st.money < (st.gs.unitCost * 8) && st.gs.stock <= 2){
      api.setNotice(econHintOneLiner("cashflow"), "red");
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
    api.setNotice(econHintOneLiner("debt"), "red");
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
     Upgrades
     ========================= */
  function upgradeToStall(st, api){
    if(st.stage >= 1){ api.log("You already have a stall (or better)."); return; }
    if(st.money < COST_CART_TO_STALL){
      api.log("You need " + api.money(COST_CART_TO_STALL) + " for a stall permit + setup.");
      api.setNotice("Not enough money to upgrade.", "red");
      return;
    }

    st.money -= COST_CART_TO_STALL;
    st.stage = 1;
    st.gs.nextRentDueDay = st.dayCount + WEEK_DAYS;
    st.gs.missedRent = 0;

    api.log("You step into the market with a stall. Bills follow you in.");
    api.setNotice("Stall purchased. Weekly rent begins.", "yellow");
  }

  function upgradeToStorefront(st, api){
    if(st.stage >= 2){ api.log("You already have a storefront."); return; }
    if(st.stage < 1){ api.log("You need a stall first."); api.setNotice("Need a stall first.", "red"); return; }
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

    if(st.money >= rent){
      st.money -= rent;
      st.gs.missedRent = 0;
      st.gs.nextRentDueDay += WEEK_DAYS;
      api.log("Rent paid: -" + api.money(rent) + ".");
      api.setNotice(econHintOneLiner("rent"), "yellow");
    } else {
      st.gs.missedRent += 1;
      st.reputation = api.clamp(st.reputation - 3, -100, 100);
      st.demand = api.clamp(st.demand - 0.06, 0.70, 1.20);
      st.gs.nextRentDueDay += WEEK_DAYS;

      api.log("You miss rent. The market board makes a note.");
      api.setNotice("You missed rent. Things get colder.", "red");

      if(st.gs.missedRent >= 2){
        gameOver(st, api, "The market board revokes your permit.\nYour stall is cleared out before sunrise.");
      }
    }
  }

  function bankruptcyCheck(st, api){
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

    setTimeout(function(){
      alert(msg + "\n\n(Your run is over.)");
      if(confirm("Restart from the beginning?")){
        localStorage.removeItem("townTrade_save_core_v1");
        location.reload();
      }
    }, 50);
  }

  /* =========================
     Town migration (added)
     ========================= */
  function canMigrate(st){
    // You can migrate once you’ve survived a bit OR if competition is crushing you
    if(st.dayCount >= 10) return true;
    if(st.gs.competitorActive) return true;
    return false;
  }

  function migrateTown(st, api){
    if(st.gs.dead) return;
    if(!canMigrate(st)){
      api.log("You’re not ready to move towns yet.");
      api.setNotice("Too early to migrate.", "red");
      return;
    }

    var cost = 90 + (st.stage * 140); // travel cost increases with setup size
    var warn =
      "Move to a new town?\n\n" +
      "- Travel cost: " + api.money(cost) + "\n" +
      "- You will lose some stock (damaged/left behind)\n" +
      "- Shipments are cancelled\n" +
      "- Reputation resets partially (new faces)\n\n" +
      "This can save you… or finish you.\n";

    if(!confirm(warn)) return;

    if(st.money < cost){
      api.log("You can't afford the travel. Need " + api.money(cost) + ".");
      api.setNotice("Not enough money to travel.", "red");
      return;
    }

    st.money -= cost;

    // Lose stock to travel
    var lost = Math.max(0, Math.floor((st.gs.stock || 0) * (0.35 + Math.random()*0.25)));
    st.gs.stock = Math.max(0, (st.gs.stock || 0) - lost);

    // Cancel shipments
    st.gs.shipments = [];

    // Reputation partially resets (new people)
    st.reputation = Math.floor((st.reputation || 0) * 0.35);

    // Reset demand to a “new town” baseline
    st.demand = 0.92 + Math.random()*0.12;

    // Reset competitor (new town, new market)
    st.gs.competitorActive = false;
    st.gs.competitorPressure = 0;

    // Advance days (travel time)
    var travelDays = 1 + (Math.random() < 0.35 ? 1 : 0); // 1–2 days
    st.dayCount += travelDays;

    // New town index
    st.gs.townIndex = (st.gs.townIndex || 1) + 1;

    api.log("You leave before dawn. Wheels creak. Days pass.");
    api.log("You arrive in Town #" + st.gs.townIndex + ". New eyes. New judgments.");
    api.setNotice(econHintOneLiner("travel"), "yellow");
  }

  /* =========================
     Unlocks
     ========================= */
  function unlocks(st, api){
    if(!st.unlocked.stall && st.gs.totalSales >= 35 && st.money >= 500){
      st.unlocked.stall = true;
      api.log("A market permit becomes possible… if you can afford it.");
      api.setNotice("NEW UPGRADE: Cart → Stall", "yellow");
    }

    if(!st.unlocked.storefront && st.stage >= 1 && st.gs.totalSales >= 180 && st.reputation >= 8 && st.money >= 2600){
      st.unlocked.storefront = true;
      api.log("A storefront lease is posted. The numbers are ugly.");
      api.setNotice("NEW UPGRADE: Stall → Storefront", "yellow");
    }

    if(!st.unlocked.gazetteOffer && st.stage >= 1 && st.reputation >= 6){
      st.unlocked.gazetteOffer = true;
      api.log("The Town Gazette offers a feature… for a fee.");
      api.setNotice("NEW OPTION: Support the Gazette", "yellow");
    }

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

    // season update
    st.gs.season = seasonName(st.dayCount);

    // shipments arrive in the morning
    processShipments(st, api);

    // rent check
    payRentIfDue(st, api);

    // daily season side effects
    applySeasonSideEffects(st, api);

    // daily random event (not every day)
    if(Math.random() < DAILY_EVENT_CHANCE){
      dailyEvent(st, api);
    }

    // competitor might appear later
    maybeSpawnCompetitor(st, api);

    // season demand multiplier influences your effective demand baseline
    var mul = seasonDemandMultiplier(st.gs.season);
    st.demand = clamp(st.demand * (0.985 + (mul - 1) * 0.35), 0.70, 1.20);

    // tiny drift based on reputation (slow, but real)
    var rep = st.reputation || 0;
    var drift = (rep / 100) * 0.015;
    st.demand = api.clamp((st.demand || 1) + drift, 0.70, 1.20);

    // soft daily summary
    if(st.dayCount > 1){
      api.log("Day " + st.dayCount + " (" + st.gs.season + "): Cash " + api.money(st.money) + ", Stock " + st.gs.stock + ", Rep " + st.reputation + ".");
    }

    bankruptcyCheck(st, api);
  }

  /* =========================
     UI injection (no index edits)
     ========================= */
  function ensureExtraButtons(st, api){
    // Set / Change price
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
          // price can be changed ANY time after first set
          setPriceFlow(st, api, true);
        };
        anchor.parentNode.insertBefore(b1, anchor);
        anchor.parentNode.insertBefore(document.createElement("br"), anchor);
      }
    }

    // Restock
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
        anchor2.parentNode.insertBefore(document.createElement("br"), anchor2.nextSibling);
        anchor2.parentNode.insertBefore(b2, anchor2.nextSibling);
        anchor2.parentNode.insertBefore(document.createElement("br"), anchor2.nextSibling);
      }
    }

    // Migrate Town (added)
    if(!api.$("migrateBtn")){
      var anchor3 = api.$("restockBtn") || api.$("serveBtn");
      if(anchor3 && anchor3.parentNode){
        var b3 = document.createElement("button");
        b3.id = "migrateBtn";
        b3.className = "home_button";
        b3.onclick = function(){
          migrateTown(st, api);
        };
        anchor3.parentNode.insertBefore(b3, anchor3.nextSibling);
        anchor3.parentNode.insertBefore(document.createElement("br"), anchor3.nextSibling);
      }
    }
  }

  function updateButtonLabels(st, api){
    var sellBtn = api.$("serveBtn");
    var discBtn = api.$("goodDeedBtn");
    var setBtn  = api.$("setPriceBtn");
    var restBtn = api.$("restockBtn");
    var migBtn  = api.$("migrateBtn");

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
      restBtn.textContent = st.gs.itemName ? ("Order stock (" + api.money(st.gs.unitCost) + " each)") : "Order stock";
    }
    if(migBtn){
      var travelCost = 90 + (st.stage * 140);
      migBtn.textContent = "Move to a new town (" + api.money(travelCost) + ")";
      // hide it early to keep Oregon Trail vibe
      migBtn.style.display = canMigrate(st) ? "" : "none";
    }

    if(api.$("loanBtn")) api.$("loanBtn").textContent = "Take a small bank loan (" + api.money(LOAN_CASH) + ")";
    if(api.$("repayBtn")) api.$("repayBtn").textContent = "Repay debt (" + api.money(REPAY_STEP) + ")";
    if(api.$("advertiseBtn")) api.$("advertiseBtn").textContent = "Run a small advertisement (" + api.money(adCost(st.stage)) + ")";
    if(api.$("upgradeToStallBtn")) api.$("upgradeToStallBtn").textContent = "Upgrade: Cart → Stall (" + api.money(COST_CART_TO_STALL) + ")";
    if(api.$("upgradeToStoreBtn")) api.$("upgradeToStoreBtn").textContent = "Upgrade: Stall → Storefront (" + api.money(COST_STALL_TO_STOREFRONT) + ")";
    if(api.$("unlockNewsBtn")) api.$("unlockNewsBtn").textContent = "Support the Town Gazette (" + api.money(GAZETTE_SUPPORT_COST) + ")";
  }

  /* =========================
     Module registration
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
        missedRent: 0,

        // added systems
        season: "Spring",
        townIndex: 1,

        competitorActive: false,
        competitorPressure: 0
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

      // Make price changing obvious
      api.log("You can change price anytime using: Set / Change price (but flipping often hurts trust).");
    },

    tick: function(st, api){
      if(st.gs.dead) return;

      if(st.seconds % DAY_SECONDS === 0){
        onNewDay(st, api);
      }

      applyInterest(st, api);
      unlocks(st, api);

      // slow drift
      if(st.seconds % 10 === 0){
        var rep = st.reputation || 0;
        var drift = (rep / 100) / 90;
        st.demand = api.clamp((st.demand || 1) + drift, 0.70, 1.20);
      }

      bankruptcyCheck(st, api);
    },

    buttons: function(st, api){
      return {
        serve: !!st.gs.itemKey && !st.gs.dead,
        discount: !!st.gs.itemKey && !st.gs.dead,

        advertise: (st.gs.gazetteSupported === true) && !st.gs.dead,

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

    story: function(st){ return storyLine(st); },

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

      // Caption status line
      if(api.$("ascii_caption")){
        var incoming = (st.gs.shipments && st.gs.shipments.length) ? st.gs.shipments.length : 0;
        var eta = "";
        if(incoming){
          var soon = st.gs.shipments.reduce(function(min, sh){ return Math.min(min, sh.arrivalDay); }, 999999);
          eta = " | Wagon ETA: day " + soon;
        }

        var compTag = st.gs.competitorActive ? " | COMPETITOR: yes" : "";

        api.$("ascii_caption").textContent =
          "Town #" + (st.gs.townIndex||1) + " | " + (st.gs.season||"Spring") +
          " | Selling: " + (st.gs.itemName || "none") +
          " | Price: " + (st.gs.sellPrice ? api.money(st.gs.sellPrice) : "unset") +
          " | Stock: " + (st.gs.stock || 0) +
          " | Cash: " + api.money(st.money) +
          " | Rep: " + st.reputation +
          eta + compTag;
      }
    },

    onLoad: function(st){
      st.gs = st.gs || {};
      st.gs.shipments = st.gs.shipments || [];
      st.gs.totalSales = st.gs.totalSales || 0;
      st.gs.missedRent = st.gs.missedRent || 0;

      if(typeof st.gs.gazetteSupported !== "boolean") st.gs.gazetteSupported = !!st.gs.gazetteSupported;
      if(typeof st.gs.dead !== "boolean") st.gs.dead = false;
      if(typeof st.gs.lastPriceChangeDay !== "number") st.gs.lastPriceChangeDay = -999;

      // new fields safety
      if(!st.gs.season) st.gs.season = seasonName(st.dayCount || 0);
      if(!st.gs.townIndex) st.gs.townIndex = 1;
      if(typeof st.gs.competitorActive !== "boolean") st.gs.competitorActive = false;
      if(typeof st.gs.competitorPressure !== "number") st.gs.competitorPressure = 0;

      st.unlocked = st.unlocked || {};
      if(typeof st.unlocked.stall !== "boolean") st.unlocked.stall = false;
      if(typeof st.unlocked.storefront !== "boolean") st.unlocked.storefront = false;
      if(typeof st.unlocked.gazetteOffer !== "boolean") st.unlocked.gazetteOffer = false;
      if(typeof st.unlocked.bank !== "boolean") st.unlocked.bank = false;
    }
  };

})();

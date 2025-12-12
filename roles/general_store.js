/* =========================================================
   Town Trade - GENERAL STORE (Hard Mode Role v2.1)
   - FIX: Sales add FULL sale price (cost already paid at restock)
   ========================================================= */
(function(){
  if(!window.TT_ROLES) window.TT_ROLES = {};
  function clamp(n,a,b){ return Math.max(a, Math.min(b,n)); }

  var ITEMS = [
    { key:"flour",   name:"Flour",   buyIn:40, unitCost:2,  tolerance: { low:2,  high:7 } },
    { key:"cloth",   name:"Cloth",   buyIn:60, unitCost:4,  tolerance: { low:4,  high:11 } },
    { key:"candles", name:"Candles", buyIn:35, unitCost:1,  tolerance: { low:1,  high:5 } },
    { key:"tools",   name:"Tools",   buyIn:90, unitCost:6,  tolerance: { low:6,  high:16 } }
  ];
  function getItemByKey(k){ for(var i=0;i<ITEMS.length;i++) if(ITEMS[i].key===k) return ITEMS[i]; return null; }

  function promptFirstItemChoice(api){
    var c = prompt(
      "Choose an item to sell:\n" +
      "1) Flour (buy-in $40, cost $2 each)\n" +
      "2) Cloth (buy-in $60, cost $4 each)\n" +
      "3) Candles (buy-in $35, cost $1 each)\n" +
      "4) Tools (buy-in $90, cost $6 each)\n\n" +
      "Type 1, 2, 3, or 4:",
      "1"
    );
    if(c === null) return null;
    if(c === "1") return ITEMS[0];
    if(c === "2") return ITEMS[1];
    if(c === "3") return ITEMS[2];
    if(c === "4") return ITEMS[3];
    api.setNotice("Invalid choice.", "red");
    api.log("Invalid item choice.");
    return "invalid";
  }

  function pickFirstItem(st, api){
    var item = promptFirstItemChoice(api);
    if(item === null || item === "invalid") return;

    if(st.money < item.buyIn){
      api.setNotice("Not enough money for that buy-in.", "red");
      api.log("Could not afford item buy-in.");
      return;
    }
    st.money -= item.buyIn;

    var p = prompt("Set your selling price for " + item.name + " (whole dollars):", String(item.unitCost + 2));
    if(p === null) return;
    p = Math.max(1, Math.floor(Number(p)));
    if(!isFinite(p)) p = item.unitCost + 2;

    var stock = prompt("How many units do you buy for starting stock? (Example: 20)", "18");
    if(stock === null) return;
    stock = Math.max(1, Math.floor(Number(stock)));
    if(!isFinite(stock)) stock = 18;

    var totalCost = stock * item.unitCost;
    if(st.money < totalCost){
      api.setNotice("Not enough money to buy that much stock.", "red");
      api.log("Not enough money for starting stock.");
      return;
    }
    st.money -= totalCost;

    st.gs.itemKey = item.key;
    st.gs.itemName = item.name;
    st.gs.unitCost = item.unitCost;
    st.gs.price = p;
    st.gs.stock = stock;
    st.gs.itemChosen = true;

    st.gs.security = 0;
    st.gs.lastRestockDay = st.dayCount || 0;

    api.setNotice("Now selling " + item.name + ".", "yellow");
    api.log("Selected " + item.name + " | price $" + p + " | stock " + stock + ".");
  }

  function promptNumber(msg, def){
    var raw = prompt(msg, String(def));
    if(raw === null) return null;
    var n = Math.floor(Number(raw));
    if(!isFinite(n)) return "invalid";
    return n;
  }

  function fairness(st){
    var it = getItemByKey(st.gs.itemKey);
    if(!it) return 0;

    var price = st.gs.price;
    var low = it.tolerance.low;
    var high = it.tolerance.high;

    if(price < low) return +1;
    if(price > high) return -1;

    var mid = (low + high) / 2;
    var span = Math.max(1, (high - low) / 2);
    var t = (price - mid) / span; // -1..+1
    return clamp(-t, -1, +1);
  }

  function priceElasticityMultiplier(st){
    var f = fairness(st);
    if(f <= -1) return 0.35;
    if(f >= +1) return 1.15;
    return 0.75 + (f * 0.25);
  }

  function repTrafficBonus(rep){
    rep = clamp(rep || 0, -100, 100);
    return (rep >= 0) ? (rep / 125) : (rep / 165);
  }

  function calcCustomersThisHour(st, api){
    var base = 0;
    var stage = clamp(st.stage || 0, 0, 2);
    var maxBase = (stage === 0) ? 2 : (stage === 1) ? 3 : 4;

    var mood = api.dayShock ? api.dayShock() : 1.0;
    var demand = (typeof st.demand === "number") ? st.demand : 1.0;
    var mult = clamp(demand * mood, 0.50, 1.75);

    var streak = (typeof st.badLuckBuffer === "number") ? st.badLuckBuffer : 0;

    var r = api.rand();
    var repB = repTrafficBonus(st.reputation || 0);

    if(r < 0.45 / mult) base = 0;
    else if(r < 0.85 / Math.max(1, mult)) base = 1;
    else base = 2;

    var nudge = repB;
    if(nudge > 0 && api.rand() < Math.min(0.65, nudge)) base += 1;
    if(nudge < 0 && api.rand() < Math.min(0.65, -nudge)) base -= 1;

    var pem = priceElasticityMultiplier(st);
    if(pem < 0.60 && api.rand() < (0.80 - pem)) base -= 1;
    if(pem > 1.05 && api.rand() < (pem - 1.05)) base += 1;

    if(base <= 0){
      streak = clamp(streak + 1, 0, 3);
      st.badLuckBuffer = streak;
      if(streak >= 2 && api.rand() < 0.35) base = 1;
    } else {
      st.badLuckBuffer = Math.max(0, streak - 1);
    }

    base = clamp(base, 0, maxBase);

    if(mult < 0.90 && base > 0 && api.rand() < (0.90 - mult)) base -= 1;
    if(mult > 1.10 && base < maxBase && api.rand() < (mult - 1.10)) base += 1;

    return clamp(base, 0, maxBase);
  }

  function repDeltaOnSale(st){
    var f = fairness(st);
    if(f <= -1) return -2;
    if(f < -0.35) return -1;
    if(f > +0.65) return +2;
    if(f > +0.20) return +1;
    return (Math.random() < 0.35) ? +1 : 0;
  }

  function actionHours(st, id){
    var stage = clamp(st.stage || 0, 0, 2);
    if(id === "serve") return 1;
    if(id === "discount") return 1;
    if(id === "set_price") return 1;
    if(id === "gossip") return 1;
    if(id === "tidy") return 1;
    if(id === "restock") return (stage === 0) ? 3 : 2;
    if(id === "loan") return 1;
    if(id === "repay") return 1;
    if(id === "upgrade_stall") return 2;
    if(id === "upgrade_storefront") return 3;
    if(id === "upgrade_helper") return 2;
    if(id === "upgrade_newspaper") return 2;
    return 0;
  }

  function doSetPrice(st, api){
    if(!st.gs.itemChosen){ api.setNotice("Pick an item first.", "red"); return; }
    var p = prompt("New price for " + st.gs.itemName + " (whole dollars):", String(st.gs.price));
    if(p === null) return;
    p = Math.max(1, Math.floor(Number(p)));
    if(!isFinite(p)) return;
    st.gs.price = p;
    api.setNotice("Price updated to $" + p + ".", "yellow");
    api.log("Price changed to $" + p + ".");
  }

  function doRestock(st, api){
    if(!st.gs.itemChosen){ api.setNotice("Pick an item first.", "red"); return; }
    var it = getItemByKey(st.gs.itemKey);
    if(!it) return;

    var shortageChance = 0.10;
    if((st.dayCount - (st.gs.lastRestockDay || 0)) <= 0) shortageChance += 0.15;
    if(api.isUnlocked("gazette")) shortageChance -= 0.03;

    if(api.rand() < shortageChance){
      api.setNotice("Supplier shortage. You come back empty-handed.", "red");
      api.log("Supplier shortage. No stock available today.");
      return;
    }

    var msg =
      "Restock " + it.name + ":\n" +
      "Current stock: " + st.gs.stock + "\n\n" +
      "Choose quantity:\n" +
      "1) 10 units  (cost $" + (10 * it.unitCost) + ")\n" +
      "2) 25 units  (5% bulk discount)\n" +
      "3) 40 units  (10% bulk discount)\n\n" +
      "Type 1, 2, or 3:";
    var c = prompt(msg, "1");
    if(c === null) return;

    var qty = 10, disc = 0;
    if(c === "1"){ qty = 10; disc = 0; }
    else if(c === "2"){ qty = 25; disc = 0.05; }
    else if(c === "3"){ qty = 40; disc = 0.10; }
    else { api.setNotice("Invalid choice.", "red"); api.log("Invalid restock choice."); return; }

    var rawCost = qty * it.unitCost;
    var cost = Math.floor(rawCost * (1 - disc));

    if(st.money < cost){
      api.setNotice("Not enough money to restock.", "red");
      api.log("Restock failed (cash too low).");
      return;
    }

    st.money -= cost;
    st.gs.stock += qty;
    st.gs.lastRestockDay = st.dayCount || 0;

    api.setNotice("Restocked +" + qty + " units (-" + api.money(cost) + ").", "yellow");
    api.log("Restocked " + qty + " " + it.name + " for -" + api.money(cost) + ".");
  }

  function doGossip(st, api){
    var mood = api.dayShock ? api.dayShock() : 1.0;
    var demand = (typeof st.demand === "number") ? st.demand : 1.0;
    var x = clamp(mood * demand, 0.5, 1.75);

    var line = "Town's quiet today.";
    if(x < 0.85) line = "People are tight with money. Feels like a slow stretch.";
    else if(x < 1.05) line = "Normal foot traffic. Nothing special.";
    else if(x < 1.25) line = "You hear talk of more buyers in town today.";
    else line = "Busy day. Folks are spending.";

    api.setNotice("You ask around for the town's mood.", "yellow");
    api.log("Gossip: " + line);
  }

  function doTidy(st, api){
    st.gs.security = 1;
    api.setNotice("You tidy up and secure your goods.", "yellow");
    api.log("You tidy up and secure your stock. Loss risk reduced for the day.");
  }

  function doLoan(st, api){
    api.unlock("bank");
    var amt = 150;
    if((st.stage || 0) === 1) amt = 220;
    if((st.stage || 0) === 2) amt = 320;

    st.money += amt;
    st.debt = (st.debt || 0) + Math.floor(amt * 1.20);

    api.setNotice("Loan taken: +" + api.money(amt) + " (debt increased).", "yellow");
    api.log("You take a bank loan: +" + api.money(amt) + ". Debt now " + api.money(st.debt) + ".");
  }

  function doRepay(st, api){
    if((st.debt || 0) <= 0){ api.setNotice("You have no debt to repay.", "red"); return; }
    var maxPay = Math.min(st.money, st.debt);
    if(maxPay <= 0){ api.setNotice("No cash available to repay.", "red"); return; }

    var n = promptNumber("How much do you repay? (Max " + maxPay + ")", Math.min(60, maxPay));
    if(n === null) return;
    if(n === "invalid"){ api.setNotice("Invalid amount.", "red"); return; }
    n = clamp(n, 1, maxPay);

    st.money -= n;
    st.debt -= n;

    api.setNotice("Repaid " + api.money(n) + ".", "yellow");
    api.log("Repaid " + api.money(n) + ". Debt now " + api.money(st.debt) + ".");
  }

  function doUpgrade(st, api, which){
    if(which === "stall"){
      if(st.stage !== 0){ api.setNotice("You already have more than a cart.", "red"); return; }
      var cost = 140;
      if(st.money < cost){ api.setNotice("Not enough money to upgrade.", "red"); return; }
      st.money -= cost;
      st.stage = 1;
      api.setNotice("Upgraded to a stall. Costs go up now.", "yellow");
      api.log("Upgrade: Cart → Stall (-" + api.money(cost) + ").");
      return;
    }

    if(which === "storefront"){
      if(st.stage !== 1){ api.setNotice("You need a stall first.", "red"); return; }
      var cost2 = 320;
      if(st.money < cost2){ api.setNotice("Not enough money to upgrade.", "red"); return; }
      st.money -= cost2;
      st.stage = 2;
      api.setNotice("Upgraded to a storefront. Mistakes hurt more.", "yellow");
      api.log("Upgrade: Stall → Storefront (-" + api.money(cost2) + ").");
      return;
    }

    if(which === "helper"){
      if(!st.gs.itemChosen){ api.setNotice("Get your business running first.", "red"); return; }
      if(api.isUnlocked("helper")){ api.setNotice("You already hired help.", "red"); return; }
      var hc = 220;
      if(st.money < hc){ api.setNotice("Not enough money to hire help.", "red"); return; }
      st.money -= hc;
      api.unlock("helper");
      api.setNotice("You hire steady help. Your hours feel less wasted.", "yellow");
      api.log("Hired steady help (-" + api.money(hc) + ").");
      return;
    }

    if(which === "newspaper"){
      if(api.isUnlocked("gazette")){ api.setNotice("The Gazette already runs.", "red"); return; }
      var nc = 90;
      if(st.money < nc){ api.setNotice("Not enough money to support the Gazette.", "red"); return; }
      st.money -= nc;
      api.unlock("gazette");
      api.setNotice("The Town Gazette starts printing rumors and moods.", "yellow");
      api.log("Supported the Gazette (-" + api.money(nc) + ").");
      return;
    }
  }

  /* ========= SALES (FIXED CASHFLOW) ========= */
  function doServe(st, api){
    if(!st.gs.itemChosen){ api.setNotice("Pick an item first.", "red"); return; }

    var n = calcCustomersThisHour(st, api);

    if(n <= 0){
      api.setNotice("No customers this hour.", "red");
      api.log("No customers this hour.");
      return;
    }

    var sold = 0;

    var f = fairness(st);
    var buyChance = 0.55 + (f * 0.20);
    buyChance = clamp(buyChance, 0.20, 0.85);
    if(api.isUnlocked("helper")) buyChance = clamp(buyChance + 0.08, 0.20, 0.92);

    for(var i=0; i<n; i++){
      if(st.gs.stock <= 0){
        api.setNotice("Out of stock.", "red");
        api.log("Out of stock. You watch buyers walk away.");
        if((st.stage || 0) >= 1) api.changeReputation(-1, "Out of stock.");
        break;
      }

      if(api.rand() > buyChance){
        if(f < -0.2) api.changeReputation(-1, "Price felt steep.");
        continue;
      }

      st.gs.stock -= 1;

      // ✅ FIX: cost is already paid at purchase time, so sale adds full price only
      st.money += st.gs.price;

      var rd = repDeltaOnSale(st);
      st.reputation = clamp((st.reputation || 0) + rd, -100, 100);

      sold += 1;

      api.setNotice("Sale made: +" + api.money(st.gs.price) + ".", "yellow");
      api.log("Sold 1 " + st.gs.itemName + " | profit " + api.money(st.gs.price - st.gs.unitCost) + " | rep " + (rd>=0?"+":"") + rd + ".");
    }

    if(sold > 0) api.log("Hour finished. Customers: " + n + " | Sold: " + sold + ".");
    else { api.setNotice("Customers came… but didn’t buy.", "red"); api.log("Customers came, but no sales."); }
  }

  function doDiscount(st, api){
    if(!st.gs.itemChosen){ api.setNotice("Pick an item first.", "red"); return; }

    var max = Math.min(25, Math.max(1, Math.floor(st.money)));
    var raw = prompt("Goodwill / discount cost in dollars? (1-" + max + ")", "3");
    if(raw === null) return;
    var d = Math.max(1, Math.floor(Number(raw)));
    if(!isFinite(d)){ api.setNotice("Invalid amount.", "red"); return; }
    d = clamp(d, 1, max);

    if(st.money < d){
      api.setNotice("Not enough money for that discount.", "red");
      api.log("Goodwill failed (low cash).");
      return;
    }

    st.money -= d;

    var repGain = 2;
    if((st.reputation || 0) > 60) repGain = 1;
    st.reputation = clamp((st.reputation || 0) + repGain, -100, 100);

    if(typeof st.demand !== "number") st.demand = 1.0;
    st.demand = clamp(st.demand + 0.03, 0.50, 1.75);

    api.setNotice("Goodwill spent (-" + api.money(d) + "). Rep +" + repGain + ".", "yellow");
    api.log("Goodwill: -" + api.money(d) + " | Rep +" + repGain + ".");
  }

  function hourlyInventoryRisk(st, api){
    if(!st.gs.itemChosen) return;
    if(st.gs.stock <= 0) return;

    var base = 0.006;
    var stockFactor = Math.min(0.020, st.gs.stock / 2000);
    var stage = clamp(st.stage || 0, 0, 2);
    var stageFactor = (stage === 0) ? 0.0 : (stage === 1) ? 0.004 : 0.006;

    var security = st.gs.security ? 0.45 : 1.0;
    var chance = (base + stockFactor + stageFactor) * security;

    if(api.rand() < chance){
      var loss = 1;
      if(st.gs.stock > 25 && api.rand() < 0.25) loss = 2;
      loss = Math.min(loss, st.gs.stock);
      st.gs.stock -= loss;

      api.setNotice("You lose some stock.", "red");
      api.log("Inventory loss: -" + loss + " " + st.gs.itemName + " (spoilage/theft).");
      if(stage >= 1) api.changeReputation(-1, "Stock loss rumors.");
    }
  }

  function driftDemand(st){
    if(typeof st.demand !== "number") st.demand = 1.0;

    var rep = clamp(st.reputation || 0, -100, 100);
    var drift = rep / 3500;

    var f = fairness(st);
    drift += (f * 0.003);

    drift += (1.0 - st.demand) * 0.02;

    st.demand = clamp(st.demand + drift, 0.55, 1.45);
  }

  function newDayReset(st, api){
    st.gs.security = 0;
    api.log("Day " + ((st.dayCount || 0) + 1) + " begins at the store.");
  }

  window.TT_ROLES["general_store"] = {
    meta: {
      name: "General Store / Trading Post",
      intro: "You start with a cart and $200. Time only moves when you act. No income is guaranteed."
    },

    init: function(st){
      st.money = 200;
      st.reputation = 0;
      st.stage = 0;
      st.debt = 0;
      st.demand = 1.0;

      st.gs = {
        started: false,
        itemChosen: false,
        itemKey: "",
        itemName: "",
        unitCost: 0,
        price: 0,
        stock: 0,
        security: 0,
        lastRestockDay: 0,
        _popupDone: false
      };
    },

    start: function(st, api){
      st.gs.started = true;
      api.setNotice("Choose what you want to sell.", "yellow");
      api.log("You open your cart.");
    },

    getActions: function(st, api){
      var acts = [];
      acts.push({ id:"wait", label:"Wait 1 hour", hours:1, enabled:true, tooltip:"Time passes. Risk still exists." });

      if(st.gs && st.gs.itemChosen){
        acts.push({ id:"serve", label:"Open for business (1 hour)", hours:1, enabled:true, tooltip:"Try to sell. Some hours are dead." });
        acts.push({ id:"restock", label:"Restock from supplier", hours:actionHours(st,"restock"), enabled:true, tooltip:"Costs time and money." });
        acts.push({ id:"set_price", label:"Change your price", hours:1, enabled:true, tooltip:"Takes time. Price affects buyers and reputation." });
        acts.push({ id:"discount", label:"Spend goodwill (discounts, favors)", hours:1, enabled:true, tooltip:"Costs money + time." });
        acts.push({ id:"tidy", label:"Tidy / secure your stock", hours:1, enabled:true, tooltip:"Reduces loss risk for the day." });
        acts.push({ id:"gossip", label:"Ask around about town mood", hours:1, enabled:true, tooltip:"Imperfect hint about traffic." });

        acts.push({ id:"loan", label:"Take a bank loan", hours:1, enabled:true, tooltip:"Quick cash now. Debt gets ugly." });
        acts.push({ id:"repay", label:"Repay debt", hours:1, enabled:(st.debt||0)>0 && st.money>0, tooltip:"Reduce debt pressure." });

        if((st.stage||0)===0) acts.push({ id:"upgrade_stall", label:"Upgrade: Cart → Stall", hours:2, enabled:true, tooltip:"More volume and daily overhead." });
        if((st.stage||0)===1) acts.push({ id:"upgrade_storefront", label:"Upgrade: Stall → Storefront", hours:3, enabled:true, tooltip:"Big overhead. Bigger mistakes." });

        if(!api.isUnlocked("helper")) acts.push({ id:"upgrade_helper", label:"Hire steady help", hours:2, enabled:true, tooltip:"Costs money. Slightly reduces wasted traffic." });
        if(!api.isUnlocked("gazette")) acts.push({ id:"upgrade_newspaper", label:"Support the Town Gazette", hours:2, enabled:true, tooltip:"Unlocks mood tools + future events." });
      }

      return acts;
    },

    story: function(st){
      if(!st.gs || !st.gs.started) return "";
      if(!st.gs.itemChosen){
        return "You have a cart and <b>$200</b>.<br/>Choose an item, set a price, and buy starting stock.<br/><br/><span class='muted'>There is no guaranteed income.</span>";
      }

      var it = getItemByKey(st.gs.itemKey);
      var fairTxt = it ? ("Customer tolerance: <b>$" + it.tolerance.low + "–$" + it.tolerance.high + "</b><br/>") : "";

      var f = fairness(st);
      var vibe =
        (f <= -1) ? "<span class='notice-red'>Overpriced.</span>" :
        (f < -0.35) ? "<span class='notice-red'>Price feels steep.</span>" :
        (f > 0.65) ? "<span class='notice-yellow'>Cheap (but risky).</span>" :
        (f > 0.2) ? "<span class='notice-yellow'>Competitive.</span>" :
        "<span class='muted'>Normal.</span>";

      return (
        "Item: <b>" + st.gs.itemName + "</b><br/>" +
        "Price: <b>$" + st.gs.price + "</b> | Cost per unit: <b>$" + st.gs.unitCost + "</b><br/>" +
        "Stock: <b>" + st.gs.stock + "</b><br/>" +
        fairTxt +
        "Pricing vibe: " + vibe + "<br/><br/>" +
        "<span class='muted'>Costs are paid when you restock. Sales add full price.</span>"
      );
    },

    renderExtra: function(st, api){
      if(st.gs && st.gs.started && !st.gs.itemChosen && !st.gs._popupDone){
        st.gs._popupDone = true;
        setTimeout(function(){ pickFirstItem(st, api); }, 60);
      }
    },

    serve: function(st, api){ doServe(st, api); },
    discount: function(st, api){ doDiscount(st, api); },
    set_price: function(st, api){ doSetPrice(st, api); },
    restock: function(st, api){ doRestock(st, api); },
    gossip: function(st, api){ doGossip(st, api); },
    tidy: function(st, api){ doTidy(st, api); },
    loan: function(st, api){ doLoan(st, api); },
    repay: function(st, api){ doRepay(st, api); },

    upgrade_stall: function(st, api){ doUpgrade(st, api, "stall"); },
    upgrade_storefront: function(st, api){ doUpgrade(st, api, "storefront"); },
    upgrade_helper: function(st, api){ doUpgrade(st, api, "helper"); },
    upgrade_newspaper: function(st, api){ doUpgrade(st, api, "newspaper"); },

    onHour: function(st, api){
      driftDemand(st);
      hourlyInventoryRisk(st, api);
    },

    onNewDay: function(st, api){
      newDayReset(st, api);
    }
  };
})();

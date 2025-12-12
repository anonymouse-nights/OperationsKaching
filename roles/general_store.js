(function(){
  if(!window.TT_ROLES) window.TT_ROLES = {};

  function clamp(n,a,b){ return Math.max(a, Math.min(b,n)); }

  function customersPerHour(st){
    var rep = st.reputation || 0;
    var cap = (st.stage === 0) ? 1 : (st.stage === 1) ? 2 : 3;

    var bonusChance =
      (st.stage === 0) ? clamp((rep + 5) / 140, 0, 0.20) :
      (st.stage === 1) ? clamp((rep + 10) / 95, 0, 0.65) :
                         clamp((rep + 15) / 80, 0, 0.85);

    var customers = 1;
    if(Math.random() < bonusChance && cap >= 2) customers = 2;
    if(Math.random() < (bonusChance * 0.6) && cap >= 3) customers = 3;

    var d = (typeof st.demand === "number") ? st.demand : 1.0;
    if(d < 0.95 && Math.random() < (0.95 - d)) customers = Math.max(0, customers - 1);

    return customers;
  }

  function priceReaction(st){
    var fair = st.gs.unitCost + 2;
    if(st.gs.price >= fair + 4) return { rep: -2, msg: "Customers think it's too expensive." };
    if(st.gs.price <= st.gs.unitCost) return { rep: +2, msg: "Customers love the price." };
    return { rep: (Math.random() < 0.5 ? 0 : 1), msg: "" };
  }

  function promptItemChoice(){
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

    if(c === "1") return { name:"Flour", buyIn:40, unitCost:2 };
    if(c === "2") return { name:"Cloth", buyIn:60, unitCost:4 };
    if(c === "3") return { name:"Candles", buyIn:35, unitCost:1 };
    if(c === "4") return { name:"Tools", buyIn:90, unitCost:6 };
    return "invalid";
  }

  function pickFirstItem(st, api){
    var item = promptItemChoice();
    if(item === null) return;
    if(item === "invalid"){
      api.setNotice("Invalid choice.", "red");
      api.log("Invalid item choice.");
      return;
    }

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

    var stock = prompt("How many units do you buy for starting stock? (Example: 20)", "20");
    if(stock === null) return;
    stock = Math.max(1, Math.floor(Number(stock)));
    if(!isFinite(stock)) stock = 20;

    var totalCost = stock * item.unitCost;
    if(st.money < totalCost){
      api.setNotice("Not enough money to buy that much stock.", "red");
      api.log("Not enough money for starting stock.");
      return;
    }
    st.money -= totalCost;

    st.gs.itemName = item.name;
    st.gs.unitCost = item.unitCost;
    st.gs.price = p;
    st.gs.stock = stock;
    st.gs.itemChosen = true;

    api.setNotice("Now selling " + item.name + ".", "yellow");
    api.log("Selected " + item.name + " | price $" + p + " | stock " + stock + ".");
  }

  function changePrice(st, api){
    if(!st.gs.itemChosen){
      api.setNotice("Pick an item first.", "red");
      return;
    }
    var p = prompt("New price for " + st.gs.itemName + " (whole dollars):", String(st.gs.price));
    if(p === null) return;
    p = Math.max(1, Math.floor(Number(p)));
    if(!isFinite(p)) return;

    st.gs.price = p;
    api.setNotice("Price updated to $" + p + ".", "yellow");
    api.log("Price changed to $" + p + ".");
  }

  window.TT_ROLES["general_store"] = {
    meta: {
      name: "General Store / Trading Post",
      intro: "You start with a cart and $200. Time passes when you try to sell."
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
        itemName: "",
        unitCost: 0,
        price: 0,
        stock: 0
      };
    },

    start: function(st, api){
      st.gs.started = true;
      api.setNotice("Choose what you want to sell.", "yellow");
      api.log("You open your cart.");
    },

    buttons: function(st){
      return {
        serve: !!(st.gs && st.gs.itemChosen),
        discount: !!(st.gs && st.gs.itemChosen),
        advertise: false,
        loan: false,
        repay: false,
        upgrades: null
      };
    },

    story: function(st){
      if(!st.gs || !st.gs.started) return "";
      if(!st.gs.itemChosen){
        return ("You have a cart and $200.<br/>Choose an item, set a price, and buy stock.");
      }
      return (
        "Item: <b>" + st.gs.itemName + "</b><br/>" +
        "Price: <b>$" + st.gs.price + "</b> | Cost: <b>$" + st.gs.unitCost + "</b><br/>" +
        "Stock: <b>" + st.gs.stock + "</b><br/><br/>" +
        "Sell = 1 hour passes."
      );
    },

    renderExtra: function(st, api){
      if(st.gs && st.gs.started && !st.gs.itemChosen && !st.gs._popupDone){
        st.gs._popupDone = true;
        setTimeout(function(){ pickFirstItem(st, api); }, 50);
      }
    },

    serve: function(st, api){
      if(!st.gs.itemChosen){
        api.setNotice("Pick an item first.", "red");
        return;
      }

      api.passHours(1);

      var n = customersPerHour(st);
      if(n <= 0){
        api.setNotice("No customers this hour.", "red");
        api.log("No customers this hour.");
        return;
      }

      var sold = 0;
      for(var i=0; i<n; i++){
        if(st.gs.stock <= 0){
          api.setNotice("Out of stock.", "red");
          api.log("Out of stock.");
          break;
        }

        var react = priceReaction(st);

        st.gs.stock -= 1;

        st.money += st.gs.price;
        st.money -= st.gs.unitCost;

        st.reputation += react.rep;
        if(st.reputation < -100) st.reputation = -100;
        if(st.reputation > 100) st.reputation = 100;

        api.setNotice("+" + api.money(st.gs.price) + " from sale", "yellow");
        api.log("Sold 1 " + st.gs.itemName + " | profit " + api.money(st.gs.price - st.gs.unitCost) + " | rep " + (react.rep>=0?"+":"") + react.rep + ".");
        if(react.msg) api.log(react.msg);

        sold += 1;
      }

      if(sold > 0) api.log("Hour finished. Sold: " + sold + ".");
    },

    discount: function(st, api){
      if(!st.gs.itemChosen){
        api.setNotice("Pick an item first.", "red");
        return;
      }

      var wantPriceChange = false;
      if(window.event && window.event.shiftKey) wantPriceChange = true;

      if(wantPriceChange){
        changePrice(st, api);
        return;
      }

      var raw = prompt("Discount amount in dollars? (Example: 2)", "2");
      if(raw === null) return;

      var d = Math.max(0, Math.floor(Number(raw)));
      if(!isFinite(d)) d = 0;

      if(st.money < d){
        api.setNotice("Not enough money for that discount.", "red");
        api.log("Discount failed (low cash).");
        return;
      }

      st.money -= d;
      st.reputation += 2;
      if(st.reputation > 100) st.reputation = 100;

      api.setNotice("Discount given (-" + api.money(d) + "). Rep +2.", "yellow");
      api.log("Discount: -" + api.money(d) + " | Rep +2.");
    },

    onHour: function(st){
      if(typeof st.demand !== "number") st.demand = 1.0;
      var drift = (st.reputation) / 2500;
      st.demand = clamp(st.demand + drift, 0.75, 1.25);
    },

    onNewDay: function(st, api){
      api.log("Day " + (st.dayCount + 1) + " begins.");
    }
  };
})();

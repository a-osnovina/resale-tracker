// Pure money and date logic for Resale Tracker. No screen or storage code lives here,
// so the same file runs in the browser (window.ResaleLogic) and in the tests (node tests/logic.test.js).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ResaleLogic = factory();
})(typeof self !== "undefined" ? self : this, function () {
  // Money is added up in whole cents so totals never drift (0.1 + 0.2 problems).
  function toCents(n) { return Math.round((Number(n) || 0) * 100); }
  function fromCents(c) { return c / 100; }

  function money(n) {
    const c = toCents(n);
    return (c < 0 ? "-" : "") + "$" + (Math.abs(c) / 100).toFixed(2);
  }

  function salePrice(item) {
    return item.soldFor !== null && item.soldFor !== undefined ? item.soldFor : item.current;
  }

  // Sold and Shipped items both count toward your profit.
  function isDone(item) {
    return item.status === "Sold" || item.status === "Shipped";
  }

  // Older bumps you paid for on this item (for example a 3 day Vinted bump, then a 7 day one later).
  // Each is { date, days, amount }. The bump on the item itself is the newest one.
  function pastBumpCents(item) {
    let cents = 0;
    (Array.isArray(item.bumpPast) ? item.bumpPast : []).forEach(function (b) { cents += toCents(b && b.amount); });
    return cents;
  }

  // A boost that costs a percent (Depop) is only paid when the item sells: the percent of the price it actually sold for.
  // A bump with a dollar amount (Vinted) is paid when you start it, so it always counts, plus any older bumps on the item.
  function feeTotal(item) {
    if (!item.bump) return fromCents(pastBumpCents(item));
    if (item.bumpRate > 0) {
      return isDone(item) ? fromCents(Math.round(toCents(salePrice(item)) * item.bumpRate / 100)) : 0;
    }
    return fromCents(toCents(item.bumpAmount) + pastBumpCents(item));
  }

  // The platform's selling fee, saved on the item when it sold: a percent of the sale price plus a flat amount.
  function platformFee(item) {
    if (!isDone(item)) return 0;
    const pct = Number(item.feePercent) > 0 ? Number(item.feePercent) : 0;
    const flat = Number(item.feeFlat) > 0 ? Number(item.feeFlat) : 0;
    if (pct === 0 && flat === 0) return 0;
    return fromCents(Math.round(toCents(salePrice(item)) * pct / 100) + toCents(flat));
  }

  // The postage label you paid for.
  function shipCostOf(item) {
    return Number(item.shipCost) > 0 ? Number(item.shipCost) : 0;
  }

  // Everything you paid out besides buying the item: bump, platform fee, postage label.
  function costsTotal(item) {
    return fromCents(toCents(feeTotal(item)) + toCents(platformFee(item)) + toCents(shipCostOf(item)));
  }

  // Profit = what it sold for, minus bump, platform fee and postage, minus what you paid for the item.
  function profitOf(item) {
    return fromCents(toCents(salePrice(item)) - toCents(costsTotal(item)) - toCents(item.cost));
  }

  // The price after a bundle discount, in whole cents: 20% off $25.00 is $20.00. A bad or missing percent means no discount.
  function bundlePrice(price, percent) {
    const pct = Number(percent) > 0 && Number(percent) <= 100 ? Number(percent) : 0;
    return fromCents(toCents(price) - Math.round(toCents(price) * pct / 100));
  }

  // Splits a lot's total cost over n items, to the cent, so the parts add up to the total exactly.
  function bulkCosts(n, total) {
    const cents = toCents(total);
    const base = Math.floor(cents / n);
    const extra = cents - base * n;
    const list = [];
    for (let i = 0; i < n; i++) list.push((base + (i < extra ? 1 : 0)) / 100);
    return list;
  }

  function parseDate(text) {
    const p = text.split("-");
    return Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }
  function formatDate(ms) { return new Date(ms).toISOString().slice(0, 10); }
  function dayDiff(fromText, toText) { return Math.round((parseDate(toText) - parseDate(fromText)) / 86400000); }
  function addDays(text, n) { return formatDate(parseDate(text) + n * 86400000); }

  // The last day of a bump. The day you start it counts as day 1, so a 3 day bump started Thursday ends Saturday.
  function bumpLastDay(startText, days) {
    return addDays(startText, Math.max(1, Math.round(Number(days)) || 1) - 1);
  }

  // What a percent boost costs for a sale price, in dollars (12% of $40.00 is $4.80).
  function boostCost(price, percent) {
    const pct = Number(percent) > 0 ? Number(percent) : 0;
    return fromCents(Math.round(toCents(price) * pct / 100));
  }

  // Business days are Monday to Friday.
  function isWeekend(ms) {
    const day = new Date(ms).getUTCDay();
    return day === 0 || day === 6;
  }

  // The first business day after the sold date. A sold item should ship by the end of that day.
  function shipByDate(soldText) {
    let t = parseDate(soldText);
    do { t += 86400000; } while (isWeekend(t));
    return formatDate(t);
  }

  // A quick name needs at least two words, like "Nike hoodie".
  function wordCount(text) {
    return String(text || "").trim().split(/\s+/).filter(function (w) { return w !== ""; }).length;
  }
  function isQuickNameOk(text) { return wordCount(text) >= 2; }
  // A new item is In progress until it has both a price and a platform, then it counts as Listed.
  function autoStatus(hasPrice, hasSite) { return hasPrice && hasSite ? "Listed" : "In progress"; }

  function capWords(text) {
    return String(text).replace(/(^|\s)(\S)/g, function (m, space, ch) { return space + ch.toUpperCase(); });
  }

  // Backup reminder: true when there is something worth saving and no backup in the last `days` days.
  function backupDue(lastBackupMs, nowMs, itemCount, days) {
    if (!(itemCount > 0)) return false;
    if (!lastBackupMs) return true;
    return nowMs - lastBackupMs > (days || 7) * 86400000;
  }


  // How old the last backup is, for the Settings row and the Back up page.
  // lastText is the saved day ("2026-10-07") or "" when there is none. level: "good" (within a week), "old", or "none".
  function backupAge(lastText, todayText) {
    if (!lastText) return { text: "Not yet", level: "none" };
    const d = dayDiff(lastText, todayText);
    if (d <= 0) return { text: "Today", level: "good" };
    if (d === 1) return { text: "Yesterday", level: "good" };
    return { text: d + " days ago", level: d <= 7 ? "good" : "old" };
  }

  // ---- colors: Mode (Automatic, Light, Dark) and Theme (Classic, Rose, Sage, Midnight, Plum) ----
  // The app saves one choice: "auto", "light", "dark", "light-rose", "light-sage", "dark-midnight" or "dark-plum".
  // "auto" follows your phone and uses the app's standard colors, so it has no theme circle of its own (look "auto").
  // "light" and "dark" on their own are Classic. Rose and Sage only exist as light themes, and Midnight and Plum only as dark ones.
  function themeParts(choice) {
    const p = String(choice || "auto").split("-");
    if (p[0] !== "light" && p[0] !== "dark") return { mode: "auto", look: "auto" };
    return { mode: p[0], look: p[1] || "classic" };
  }
  // Tapping a Mode button keeps your theme when it fits that mode, otherwise falls back to Classic.
  function themeForMode(choice, mode) {
    const look = themeParts(choice).look;
    if (mode === "light") return look === "rose" || look === "sage" ? "light-" + look : "light";
    if (mode === "dark") return look === "midnight" || look === "plum" ? "dark-" + look : "dark";
    return "auto";
  }
  // Tapping a theme circle: the others switch to the mode they belong to. Classic keeps Dark if you are on Dark, otherwise it is Light.
  function themeForLook(choice, look) {
    if (look === "rose" || look === "sage") return "light-" + look;
    if (look === "midnight" || look === "plum") return "dark-" + look;
    return themeParts(choice).mode === "dark" ? "dark" : "light";
  }

  // ---- withdrawals ----
  // Money you can cash out = starting balance + profit from sold items not yet withdrawn.
  function itemMoney(items, site) {
    let cents = 0;
    items.forEach(function (it) {
      if (!isDone(it) || it.withdrawn) return;
      if (site !== undefined && site !== null && it.site !== site) return;
      cents += toCents(profitOf(it));
    });
    return cents;
  }
  function startMoney(balances, site) {
    let cents = 0;
    Object.keys(balances || {}).forEach(function (name) {
      if (site !== undefined && site !== null && name !== site) return;
      cents += toCents(balances[name]);
    });
    return cents;
  }
  // Paid investments that have not been settled yet come out of your overall balance.
  function goalsSpent(goals) {
    let cents = 0;
    (goals || []).forEach(function (g) { if (g.purchased && !g.settled) cents += toCents(g.amount); });
    return cents;
  }
  // ---- partial withdrawals ----
  // Taking out only some of the money is saved as a record with `parts`, like { Depop: 30, Vinted: 20 }.
  // The sales themselves stay as they are; the record just subtracts that money from what you can still withdraw.
  // A later full withdrawal "settles" those parts (w.settled = [{ site, by }]) so they are not subtracted twice.
  function takenMoney(withdrawals, site) {
    let cents = 0;
    (withdrawals || []).forEach(function (w) {
      if (!w || !w.parts) return;
      Object.keys(w.parts).forEach(function (s) {
        if (site !== undefined && site !== null && s !== site) return;
        if ((w.settled || []).some(function (x) { return x.site === s; })) return;
        cents += toCents(w.parts[s]);
      });
    });
    return cents;
  }
  // The money held on each platform right now (never below zero), in cents.
  function platformCents(items, balances, platform, withdrawals) {
    return Math.max(0, startMoney(balances, platform) + itemMoney(items, platform) - takenMoney(withdrawals, platform));
  }
  function sitesOf(items, balances) {
    const seen = {};
    Object.keys(balances || {}).forEach(function (n) { seen[n] = 1; });
    items.forEach(function (it) { if (it.site) seen[it.site] = 1; });
    return Object.keys(seen).sort();
  }
  // What a withdrawal would pay out. platform = null means everything ("Total").
  // `withdrawals` (the history) is optional; pass it so earlier partial withdrawals are taken off.
  // Returns { amount, blocked } where blocked is "" or a plain-words reason it can't be done.
  function withdrawPlan(items, balances, goals, platform, withdrawals) {
    const spent = goalsSpent(goals);
    const everything = startMoney(balances) + itemMoney(items) - spent - takenMoney(withdrawals);
    if (platform === null || platform === undefined) {
      return { amount: fromCents(Math.max(0, everything)), blocked: everything > 0 ? "" : "There is nothing to withdraw yet." };
    }
    const mine = startMoney(balances, platform) + itemMoney(items, platform) - takenMoney(withdrawals, platform);
    if (mine <= 0) return { amount: 0, blocked: "Nothing to withdraw from " + platform + " yet." };
    if (everything - mine < 0) {
      return { amount: fromCents(mine), blocked: "Investments you marked paid come out of your overall balance, so withdrawing all of " + platform + " would leave them unpaid. Use Total instead." };
    }
    return { amount: fromCents(mine), blocked: "" };
  }
  // The most you can take as a chosen amount: from one platform, or (null) from everything.
  function withdrawMax(items, balances, goals, platform, withdrawals) {
    const everything = Math.max(0, startMoney(balances) + itemMoney(items) - goalsSpent(goals) - takenMoney(withdrawals));
    if (platform === null || platform === undefined) return fromCents(everything);
    return fromCents(Math.min(everything, platformCents(items, balances, platform, withdrawals)));
  }
  // Checks a chosen amount. Returns { ok, reason, parts } where parts says how much comes from each platform.
  // From "All platforms" the money is taken from the platform holding the most first.
  function partialPlan(items, balances, goals, platform, amount, withdrawals) {
    const cents = toCents(amount);
    const max = toCents(withdrawMax(items, balances, goals, platform, withdrawals));
    const where = platform ? platform : "your balance";
    if (!(cents > 0)) return { ok: false, reason: "Type an amount above $0.00.", parts: {} };
    if (cents > max) return { ok: false, reason: max > 0 ? "You can take at most " + money(fromCents(max)) + " from " + where + "." : "There is nothing to withdraw from " + where + " yet.", parts: {} };
    const parts = {};
    if (platform) {
      parts[platform] = fromCents(cents);
    } else {
      let left = cents;
      sitesOf(items, balances).map(function (s) { return { s: s, c: platformCents(items, balances, s, withdrawals) }; })
        .sort(function (x, y) { return y.c - x.c || (x.s < y.s ? -1 : 1); })
        .forEach(function (p) {
          if (left <= 0 || p.c <= 0) return;
          const take = Math.min(left, p.c);
          parts[p.s] = fromCents(take);
          left -= take;
        });
    }
    return { ok: true, reason: "", parts: parts };
  }
  // Takes out a chosen amount. Changes nothing but returns the record to add to the history (or null if it can't be done).
  function partialWithdrawal(items, balances, goals, platform, amount, id, dateText, withdrawals) {
    const plan = partialPlan(items, balances, goals, platform, amount, withdrawals);
    if (!plan.ok) return null;
    return { id: id, date: dateText, amount: fromCents(toCents(amount)), platform: platform || "", balances: {}, parts: plan.parts, settled: [] };
  }
  // Does the withdrawal. Changes items, balances and goals, and returns the record to keep in the history.
  function applyWithdrawal(items, balances, goals, platform, id, dateText, withdrawals) {
    const plan = withdrawPlan(items, balances, goals, platform, withdrawals);
    const record = { id: id, date: dateText, amount: plan.amount, platform: platform || "", balances: {} };
    Object.keys(balances).forEach(function (name) { record.balances[name] = balances[name] || 0; });
    const total = platform === null || platform === undefined;
    items.forEach(function (it) {
      if (isDone(it) && !it.withdrawn && (total || it.site === platform)) it.withdrawn = id;
    });
    if (total) goals.forEach(function (g) { if (g.purchased && !g.settled) g.settled = id; });
    Object.keys(balances).forEach(function (name) { if (total || name === platform) balances[name] = 0; });
    (withdrawals || []).forEach(function (w) {
      if (!w || !w.parts) return;
      if (!Array.isArray(w.settled)) w.settled = [];
      Object.keys(w.parts).forEach(function (s) {
        if ((total || s === platform) && !w.settled.some(function (x) { return x.site === s; })) w.settled.push({ site: s, by: id });
      });
    });
    return record;
  }
  // Puts everything back the way it was before that withdrawal.
  function undoWithdrawal(items, balances, goals, record, withdrawals) {
    items.forEach(function (it) { if (it.withdrawn === record.id) it.withdrawn = 0; });
    goals.forEach(function (g) { if (g.settled === record.id) g.settled = 0; });
    Object.keys(record.balances).forEach(function (name) { balances[name] = record.balances[name]; });
    (withdrawals || []).forEach(function (w) {
      if (w && Array.isArray(w.settled)) w.settled = w.settled.filter(function (x) { return x.by !== record.id; });
    });
  }

  // ---- investments that repeat (rent every month, a subscription every week, and so on) ----
  // A repeating investment has a schedule: repeat = "daily", "weekly", "monthly" or "yearly",
  // plus repeatDay (weekday 0-6 with 0 = Sunday for weekly, day of the month 1-31 for monthly and yearly)
  // and repeatMonth (1-12, yearly only). The "period" is the stretch since the most recent due date.
  // When you mark it paid, the date that period started on is saved on it (its "cycle").
  // When a new period starts, the money you paid stays as a separate paid record, so your balance stays right,
  // and the investment goes back to unpaid.
  const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const REPEATS = ["none", "daily", "weekly", "monthly", "yearly"];
  function monthOf(dateText) { return String(dateText || "").slice(0, 7); }
  // "2026-10" -> "Oct 2026"
  function monthLabel(month) {
    const p = String(month || "").split("-");
    const name = MONTH_NAMES[Number(p[1]) - 1];
    return name ? name + " " + p[0] : String(month || "");
  }
  function daysInMonth(year, month) { return new Date(Date.UTC(year, month, 0)).getUTCDate(); }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function clampInt(value, low, high, fallback) {
    const n = Math.round(Number(value));
    if (!(n >= low && n <= high)) return fallback;
    return n;
  }
  function dueDate(year, month, day) { return year + "-" + pad2(month) + "-" + pad2(Math.min(day, daysInMonth(year, month))); }
  // The date the current period started on (the most recent due date up to and including today). "" if it doesn't repeat.
  function periodStart(goal, todayText) {
    const repeat = goal && goal.repeat;
    if (REPEATS.indexOf(repeat) < 1) return "";
    if (repeat === "daily") return todayText;
    if (repeat === "weekly") {
      const want = clampInt(goal.repeatDay, 0, 6, 1);
      const have = new Date(parseDate(todayText)).getUTCDay();
      return addDays(todayText, -((have - want + 7) % 7));
    }
    const p = todayText.split("-").map(Number);
    const day = clampInt(goal.repeatDay, 1, 31, 1);
    if (repeat === "monthly") {
      const here = dueDate(p[0], p[1], day);
      if (here <= todayText) return here;
      return p[1] === 1 ? dueDate(p[0] - 1, 12, day) : dueDate(p[0], p[1] - 1, day);
    }
    const month = clampInt(goal.repeatMonth, 1, 12, 1);
    const thisYear = dueDate(p[0], month, day);
    return thisYear <= todayText ? thisYear : dueDate(p[0] - 1, month, day);
  }
  function shortDay(dateText) {
    const p = String(dateText).split("-");
    return MONTH_NAMES[Number(p[1]) - 1] + " " + Number(p[2]);
  }
  function ordinal(n) {
    const t = n % 100;
    if (t >= 11 && t <= 13) return n + "th";
    return n + (["th", "st", "nd", "rd"][n % 10] || "th");
  }
  // Is this repeating investment due on this exact day? (the day a new period starts)
  function isDueOn(goal, dateText) {
    const start = periodStart(goal, dateText);
    return start !== "" && start === dateText;
  }
  // What a paid period is called: "Oct 2026", "week of Oct 5", "Oct 6", "2026"
  function periodLabel(goal, key) {
    if (!key) return "";
    if (key.length === 7) return monthLabel(key);
    if (goal.repeat === "weekly") return "week of " + shortDay(key);
    if (goal.repeat === "daily") return shortDay(key);
    if (goal.repeat === "yearly") return key.slice(0, 4);
    return monthLabel(key.slice(0, 7));
  }
  // A plain-words description of the schedule.
  function repeatText(goal) {
    if (!goal || REPEATS.indexOf(goal.repeat) < 1) return "";
    if (goal.repeat === "daily") return "Every day";
    if (goal.repeat === "weekly") return "Every week on " + DAY_NAMES[clampInt(goal.repeatDay, 0, 6, 1)];
    const day = clampInt(goal.repeatDay, 1, 31, 1);
    const dayText = day === 31 ? "the last day" : "the " + ordinal(day);
    if (goal.repeat === "monthly") return "Every month on " + dayText;
    return "Every year on " + MONTH_NAMES[clampInt(goal.repeatMonth, 1, 12, 1) - 1] + " " + day;
  }
  // Old saves stored just the month ("2026-10"). Treat that as the first day of the month.
  function normalCycle(cycle) { return String(cycle || "").length === 7 ? cycle + "-01" : String(cycle || ""); }
  function resetInvestment(goals, goal, key) {
    if (goal.purchased) {
      const paid = goal.cycle || key;
      goals.push({
        name: goal.name + " (" + periodLabel(goal, paid) + ")",
        amount: goal.amount,
        purchased: true,
        settled: goal.settled || 0,
        repeat: "none",
        repeatDay: 1,
        repeatMonth: 1,
        autoReset: false,
        cycle: ""
      });
    }
    goal.purchased = false;
    goal.settled = 0;
    goal.cycle = key;
  }
  // Resets every paid repeating investment that is set to reset by itself and was paid in an earlier period.
  // Returns the names that were reset.
  function rolloverInvestments(goals, todayText) {
    const names = [];
    goals.slice().forEach(function (g) {
      const key = periodStart(g, todayText);
      if (key === "" || !g.autoReset || !g.purchased || !g.cycle) return;
      const paidKey = normalCycle(g.cycle);
      if (paidKey < key) {
        resetInvestment(goals, g, key);
        names.push(g.name);
      }
    });
    return names;
  }

  // ---- Platforms and fees page ----
  // The selling fee written in words, like "3.3% + $0.45". Empty when no fee is set.
  function feeText(p) {
    const pct = Number(p.feePercent) > 0 ? Number(p.feePercent) : 0;
    const flat = Number(p.feeFlat) > 0 ? Number(p.feeFlat) : 0;
    const parts = [];
    if (pct > 0) parts.push(String(pct) + "%");
    if (flat > 0) parts.push(money(flat));
    return parts.join(" + ");
  }

  // The bump cost written in words, like "bump 12%".
  function bumpText(p) {
    const v = Number(p.bumpValue) > 0 ? Number(p.bumpValue) : 0;
    if (p.bumpType === "percent" && v > 0) return "bump " + v + "%";
    if (p.bumpType === "flat" && v > 0) return "bump " + money(v);
    if (p.bumpType === "ask") return "you type the bump cost";
    return "no bump cost set";
  }

  // The example sale: what one sale at this price costs in fees and what you keep.
  // Uses the same math as a real sale (a percent of the price plus a flat amount, in whole cents).
  // bump and keepWithBump are null when the bump cost is typed each time, because it is not known.
  function feeExample(p, price) {
    const priceCents = Math.max(0, toCents(price));
    const pct = Number(p.feePercent) > 0 ? Number(p.feePercent) : 0;
    const flat = Number(p.feeFlat) > 0 ? Number(p.feeFlat) : 0;
    const feeCents = pct === 0 && flat === 0 ? 0 : Math.round(priceCents * pct / 100) + toCents(flat);
    const keepCents = priceCents - feeCents;
    const v = Number(p.bumpValue) > 0 ? Number(p.bumpValue) : 0;
    let bumpCents = null;
    if (p.bumpType === "percent") bumpCents = Math.round(priceCents * v / 100);
    else if (p.bumpType === "flat") bumpCents = toCents(v);
    return {
      price: fromCents(priceCents),
      fee: fromCents(feeCents),
      keep: fromCents(keepCents),
      bump: bumpCents === null ? null : fromCents(bumpCents),
      keepWithBump: bumpCents === null ? null : fromCents(keepCents - bumpCents)
    };
  }

  // ---- the Profit tab: one month, all platforms or one platform ----
  // month is "2026-10". site is a platform name, or "All" / "" / null for every platform.
  function prevMonth(month) {
    const p = String(month).split("-").map(Number);
    return p[1] === 1 ? (p[0] - 1) + "-12" : p[0] + "-" + pad2(p[1] - 1);
  }
  function nextMonth(month) {
    const p = String(month).split("-").map(Number);
    return p[1] === 12 ? (p[0] + 1) + "-01" : p[0] + "-" + pad2(p[1] + 1);
  }
  function daysIn(month) {
    const p = String(month).split("-").map(Number);
    return daysInMonth(p[0], p[1]);
  }
  function wantSite(item, site) { return !site || site === "All" || item.site === site; }
  // Sold items whose sold date falls in that month.
  function soldInMonth(items, month, site) {
    return items.filter(function (it) {
      return isDone(it) && !!it.sold && monthOf(it.sold) === month && wantSite(it, site);
    });
  }
  // The rows of the table: sales minus fees, boost/bump, postage and item cost leaves profit. All in dollars.
  function profitTable(items, month, site) {
    let sales = 0, fees = 0, bump = 0, ship = 0, cost = 0;
    const list = soldInMonth(items, month, site);
    list.forEach(function (it) {
      sales += toCents(salePrice(it));
      fees += toCents(platformFee(it));
      bump += toCents(feeTotal(it));
      ship += toCents(shipCostOf(it));
      cost += toCents(it.cost);
    });
    return {
      count: list.length,
      sales: fromCents(sales), fees: fromCents(fees), bump: fromCents(bump),
      ship: fromCents(ship), cost: fromCents(cost),
      profit: fromCents(sales - fees - bump - ship - cost)
    };
  }
  // Running total of profit for day 1, 2, 3 ... throughDay of that month (an array with one number per day).
  function cumulativeProfit(items, month, site, throughDay) {
    const perDay = [];
    for (let d = 0; d < throughDay; d++) perDay.push(0);
    soldInMonth(items, month, site).forEach(function (it) {
      const day = Number(String(it.sold).slice(8, 10));
      if (day >= 1 && day <= throughDay) perDay[day - 1] += toCents(profitOf(it));
    });
    const out = [];
    let run = 0;
    perDay.forEach(function (c) { run += c; out.push(fromCents(run)); });
    return out;
  }

  // ---- Plan: shipping days and money goal ----
  // Weekdays are numbered 0 = Monday ... 6 = Sunday.
  // How many business days (Mon to Fri) a parcel waits if it sells on each weekday, after you have shipped that day.
  // It leaves on the next shipping day. Returns 7 numbers, or null when no shipping days are chosen.
  function shipWaits(shipDays) {
    const days = (shipDays || []).filter(function (d) { return d >= 0 && d <= 6; });
    if (!days.length) return null;
    const out = [];
    for (let w = 0; w < 7; w++) {
      let wait = 0;
      for (let step = 1; step <= 7; step++) {
        const d = (w + step) % 7;
        if (d < 5) wait++;
        if (days.indexOf(d) !== -1) break;
      }
      out.push(wait);
    }
    return out;
  }

  // Which sale days would be late, and which single extra day (Mon to Fri) would fix them.
  function shipCoverage(shipDays, limit) {
    const waits = shipWaits(shipDays);
    if (!waits) return { waits: null, late: [], fixes: [] };
    const max = Math.max(1, Math.round(Number(limit)) || 2);
    function lateOf(list) { const w = shipWaits(list); const r = []; w.forEach(function (n, i) { if (n > max) r.push(i); }); return r; }
    const late = lateOf(shipDays);
    const fixes = [];
    if (late.length) {
      for (let d = 0; d < 5; d++) {
        if (shipDays.indexOf(d) !== -1) continue;
        if (lateOf(shipDays.concat([d])).length === 0) fixes.push(d);
      }
    }
    return { waits: waits, late: late, fixes: fixes };
  }

  // What you sell like, from your sold items in the last `days` days (default 90).
  // sellRate = the share of items that ended up sold, daysToSell = the typical days from posting to selling.
  function salesStats(items, todayText, days, listedNow) {
    const span = days || 90;
    const sold = items.filter(function (it) {
      return isDone(it) && it.sold && dayDiff(it.sold, todayText) >= 0 && dayDiff(it.sold, todayText) <= span;
    });
    const prices = sold.map(function (it) { return Number(salePrice(it)) || 0; }).filter(function (p) { return p > 0; });
    const avg = prices.length ? prices.reduce(function (a, b) { return a + b; }, 0) / prices.length : 0;
    const waits = sold.filter(function (it) { return it.posted; }).map(function (it) { return Math.max(0, dayDiff(it.posted, it.sold)); }).sort(function (a, b) { return a - b; });
    const mid = waits.length ? (waits.length % 2 ? waits[(waits.length - 1) / 2] : (waits[waits.length / 2 - 1] + waits[waits.length / 2]) / 2) : 21;
    const listed = Math.max(0, Number(listedNow) || 0);
    const rate = sold.length + listed > 0 && sold.length >= 3 ? Math.min(1, Math.max(0.1, sold.length / (sold.length + listed))) : 1 / 3;
    return { count: sold.length, avgPrice: Math.round(avg * 100) / 100, daysToSell: Math.max(1, Math.round(mid)), sellRate: rate, enough: sold.length >= 3 };
  }

  // How much sold since the goal started (sales, in dollars).
  function earnedSince(items, startText, todayText) {
    let cents = 0;
    items.forEach(function (it) {
      if (isDone(it) && it.sold && it.sold >= startText && it.sold <= todayText) cents += toCents(salePrice(it));
    });
    return fromCents(cents);
  }

  // The goal estimate: how many sales, how many items to list, and by when.
  function goalPlan(o) {
    const goal = Number(o.goal) || 0;
    const remaining = Math.max(0, goal - (Number(o.earned) || 0));
    const avg = Number(o.avgPrice) > 0 ? Number(o.avgPrice) : 0;
    const rate = Number(o.sellRate) > 0 ? Number(o.sellRate) : 1 / 3;
    const salesNeeded = avg > 0 ? Math.ceil(remaining / avg - 1e-9) : 0;
    const expected = Math.floor((Number(o.listedNow) || 0) * rate + 1e-9);
    const stillToSell = Math.max(0, salesNeeded - expected);
    const listingsNeeded = Math.ceil(stillToSell / rate - 1e-9);
    const listBy = addDays(o.by, -Math.max(0, Math.round(Number(o.daysToSell) || 0)));
    const daysLeft = dayDiff(o.today, listBy);
    const weeksLeft = daysLeft > 0 ? Math.max(1, Math.ceil(daysLeft / 7)) : 0;
    const perWeek = listingsNeeded === 0 ? 0 : weeksLeft > 0 ? Math.ceil(listingsNeeded / weeksLeft) : listingsNeeded;
    const mins = Number(o.minutesPerItem) > 0 ? Number(o.minutesPerItem) : 0;
    return {
      remaining: remaining, salesNeeded: salesNeeded, expected: expected, listingsNeeded: listingsNeeded,
      listBy: listBy, daysLeft: daysLeft, weeksLeft: weeksLeft, perWeek: perWeek,
      hours: Math.round(listingsNeeded * mins / 6) / 10, tooLate: listingsNeeded > 0 && weeksLeft === 0,
      done: remaining === 0
    };
  }

  // "What if my items sold for this much": sales needed at each price.
  function priceOptions(remaining, prices) {
    return prices.filter(function (p) { return p > 0; }).map(function (p) { return { price: p, sales: Math.ceil(remaining / p - 1e-9) }; });
  }

  return {
    feeText: feeText, bumpText: bumpText, feeExample: feeExample,
    toCents: toCents, money: money, salePrice: salePrice, isDone: isDone, feeTotal: feeTotal,
    platformFee: platformFee, shipCostOf: shipCostOf, costsTotal: costsTotal, profitOf: profitOf,
    bumpLastDay: bumpLastDay, boostCost: boostCost, pastBumpCents: pastBumpCents,
    bundlePrice: bundlePrice, bulkCosts: bulkCosts, parseDate: parseDate, formatDate: formatDate, dayDiff: dayDiff, addDays: addDays,
    isWeekend: isWeekend, shipByDate: shipByDate, wordCount: wordCount, isQuickNameOk: isQuickNameOk, autoStatus: autoStatus,
    capWords: capWords, backupDue: backupDue, backupAge: backupAge,
    themeParts: themeParts, themeForMode: themeForMode, themeForLook: themeForLook,
    withdrawPlan: withdrawPlan, applyWithdrawal: applyWithdrawal, undoWithdrawal: undoWithdrawal,
    takenMoney: takenMoney, withdrawMax: withdrawMax, partialPlan: partialPlan, partialWithdrawal: partialWithdrawal,
    monthOf: monthOf, monthLabel: monthLabel, periodStart: periodStart, isDueOn: isDueOn, periodLabel: periodLabel, repeatText: repeatText,
    resetInvestment: resetInvestment, rolloverInvestments: rolloverInvestments,
    prevMonth: prevMonth, nextMonth: nextMonth, daysIn: daysIn, soldInMonth: soldInMonth,
    profitTable: profitTable, cumulativeProfit: cumulativeProfit,
    shipWaits: shipWaits, shipCoverage: shipCoverage, salesStats: salesStats, earnedSince: earnedSince, goalPlan: goalPlan, priceOptions: priceOptions
  };
});

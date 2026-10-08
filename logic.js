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
  // What a withdrawal would pay out. platform = null means everything ("Total").
  // Returns { amount, blocked } where blocked is "" or a plain-words reason it can't be done.
  function withdrawPlan(items, balances, goals, platform) {
    const spent = goalsSpent(goals);
    const everything = startMoney(balances) + itemMoney(items) - spent;
    if (platform === null || platform === undefined) {
      return { amount: fromCents(Math.max(0, everything)), blocked: everything > 0 ? "" : "There is nothing to withdraw yet." };
    }
    const mine = startMoney(balances, platform) + itemMoney(items, platform);
    if (mine <= 0) return { amount: 0, blocked: "Nothing to withdraw from " + platform + " yet." };
    if (everything - mine < 0) {
      return { amount: fromCents(mine), blocked: "Investments you marked paid come out of your overall balance, so withdrawing all of " + platform + " would leave them unpaid. Use Total instead." };
    }
    return { amount: fromCents(mine), blocked: "" };
  }
  // Does the withdrawal. Changes items, balances and goals, and returns the record to keep in the history.
  function applyWithdrawal(items, balances, goals, platform, id, dateText) {
    const plan = withdrawPlan(items, balances, goals, platform);
    const record = { id: id, date: dateText, amount: plan.amount, platform: platform || "", balances: {} };
    Object.keys(balances).forEach(function (name) { record.balances[name] = balances[name] || 0; });
    const total = platform === null || platform === undefined;
    items.forEach(function (it) {
      if (isDone(it) && !it.withdrawn && (total || it.site === platform)) it.withdrawn = id;
    });
    if (total) goals.forEach(function (g) { if (g.purchased && !g.settled) g.settled = id; });
    Object.keys(balances).forEach(function (name) { if (total || name === platform) balances[name] = 0; });
    return record;
  }
  // Puts everything back the way it was before that withdrawal.
  function undoWithdrawal(items, balances, goals, record) {
    items.forEach(function (it) { if (it.withdrawn === record.id) it.withdrawn = 0; });
    goals.forEach(function (g) { if (g.settled === record.id) g.settled = 0; });
    Object.keys(record.balances).forEach(function (name) { balances[name] = record.balances[name]; });
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
    monthOf: monthOf, monthLabel: monthLabel, periodStart: periodStart, isDueOn: isDueOn, periodLabel: periodLabel, repeatText: repeatText,
    resetInvestment: resetInvestment, rolloverInvestments: rolloverInvestments
  };
});

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

  // A bump or ad costs a percent of the current price (the percent saved with the item) or a dollar amount.
  function feeTotal(item) {
    if (!item.bump) return 0;
    if (item.bumpRate > 0) return Math.round(item.current * item.bumpRate) / 100;
    return item.bumpAmount || 0;
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

  function capWords(text) {
    return String(text).replace(/(^|\s)(\S)/g, function (m, space, ch) { return space + ch.toUpperCase(); });
  }

  // Backup reminder: true when there is something worth saving and no backup in the last `days` days.
  function backupDue(lastBackupMs, nowMs, itemCount, days) {
    if (!(itemCount > 0)) return false;
    if (!lastBackupMs) return true;
    return nowMs - lastBackupMs > (days || 7) * 86400000;
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

  return {
    toCents: toCents, money: money, salePrice: salePrice, isDone: isDone, feeTotal: feeTotal,
    platformFee: platformFee, shipCostOf: shipCostOf, costsTotal: costsTotal, profitOf: profitOf,
    bulkCosts: bulkCosts, parseDate: parseDate, formatDate: formatDate, dayDiff: dayDiff, addDays: addDays,
    isWeekend: isWeekend, shipByDate: shipByDate, wordCount: wordCount, isQuickNameOk: isQuickNameOk,
    capWords: capWords, backupDue: backupDue,
    withdrawPlan: withdrawPlan, applyWithdrawal: applyWithdrawal, undoWithdrawal: undoWithdrawal,
    monthOf: monthOf, monthLabel: monthLabel, periodStart: periodStart, isDueOn: isDueOn, periodLabel: periodLabel, repeatText: repeatText,
    resetInvestment: resetInvestment, rolloverInvestments: rolloverInvestments
  };
});

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
  // Purchased goals that have not been settled yet are paid out of your overall balance.
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
      return { amount: fromCents(mine), blocked: "Goals you marked purchased are paid from your overall balance, so withdrawing all of " + platform + " would leave them unpaid. Use Total instead." };
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

  return {
    toCents: toCents, money: money, salePrice: salePrice, isDone: isDone, feeTotal: feeTotal,
    platformFee: platformFee, shipCostOf: shipCostOf, costsTotal: costsTotal, profitOf: profitOf,
    bulkCosts: bulkCosts, parseDate: parseDate, formatDate: formatDate, dayDiff: dayDiff, addDays: addDays,
    isWeekend: isWeekend, shipByDate: shipByDate, wordCount: wordCount, isQuickNameOk: isQuickNameOk,
    capWords: capWords, backupDue: backupDue,
    withdrawPlan: withdrawPlan, applyWithdrawal: applyWithdrawal, undoWithdrawal: undoWithdrawal
  };
});  const parts = L.bulkCosts(3, 10);
  assert.deepStrictEqual(parts, [3.34, 3.33, 3.33]);
  assert.strictEqual(Math.round(parts.reduce((a, b) => a + b, 0) * 100), 1000);
});
test("bulk split of 7 items for 100", () => {
  const parts = L.bulkCosts(7, 100);
  assert.strictEqual(Math.round(parts.reduce((a, b) => a + b, 0) * 100), 10000);
});
test("ship by: Monday sale -> Tuesday", () => assert.strictEqual(L.shipByDate("2026-10-05"), "2026-10-06"));
test("ship by: Friday sale -> Monday", () => assert.strictEqual(L.shipByDate("2026-10-09"), "2026-10-12"));
test("ship by: Saturday sale -> Monday", () => assert.strictEqual(L.shipByDate("2026-10-10"), "2026-10-12"));
test("ship by: Sunday sale -> Monday", () => assert.strictEqual(L.shipByDate("2026-10-11"), "2026-10-12"));
test("ship by crosses a month end", () => assert.strictEqual(L.shipByDate("2026-10-30"), "2026-11-02"));
test("day maths", () => {
  assert.strictEqual(L.dayDiff("2026-10-01", "2026-10-06"), 5);
  assert.strictEqual(L.addDays("2026-02-27", 2), "2026-03-01");
});
test("quick name needs two words", () => {
  assert.ok(!L.isQuickNameOk(""));
  assert.ok(!L.isQuickNameOk("   "));
  assert.ok(!L.isQuickNameOk("Hoodie"));
  assert.ok(L.isQuickNameOk("Nike hoodie"));
  assert.ok(L.isQuickNameOk("  Black   Nike hoodie "));
});
test("capWords", () => assert.strictEqual(L.capWords("nike black hoodie"), "Nike Black Hoodie"));
test("backup reminder", () => {
  const day = 86400000, now = 100 * day;
  assert.ok(!L.backupDue(0, now, 0, 7));
  assert.ok(L.backupDue(0, now, 3, 7));
  assert.ok(!L.backupDue(now - 2 * day, now, 3, 7));
  assert.ok(L.backupDue(now - 8 * day, now, 3, 7));
});

// ---- withdrawals ----
const done = (site, price, o) => Object.assign({ status: "Sold", site: site, current: price, soldFor: price, cost: 0 }, o);
const shop = () => ({
  items: [done("Depop", 50), done("Depop", 20), done("Vinted", 30), { status: "Listed", site: "Depop", current: 99, soldFor: null, cost: 0 }],
  balances: { Depop: 5, Vinted: 0, eBay: 10 },
  goals: []
});
test("total available = starting balances + unwithdrawn profit", () => {
  const s = shop();
  assert.strictEqual(L.withdrawPlan(s.items, s.balances, s.goals, null).amount, 115);
});
test("per platform amount counts only that platform", () => {
  const s = shop();
  assert.strictEqual(L.withdrawPlan(s.items, s.balances, s.goals, "Depop").amount, 75);
  assert.strictEqual(L.withdrawPlan(s.items, s.balances, s.goals, "Vinted").amount, 30);
  assert.strictEqual(L.withdrawPlan(s.items, s.balances, s.goals, "eBay").amount, 10);
});
test("withdrawing one platform leaves the others alone", () => {
  const s = shop();
  const rec = L.applyWithdrawal(s.items, s.balances, s.goals, "Depop", 111, "2026-10-06");
  assert.strictEqual(rec.amount, 75);
  assert.strictEqual(rec.platform, "Depop");
  assert.strictEqual(s.balances.Depop, 0);
  assert.strictEqual(s.balances.eBay, 10);
  assert.strictEqual(L.withdrawPlan(s.items, s.balances, s.goals, "Depop").amount, 0);
  assert.strictEqual(L.withdrawPlan(s.items, s.balances, s.goals, null).amount, 40);
});
test("withdrawing the total zeroes everything", () => {
  const s = shop();
  const rec = L.applyWithdrawal(s.items, s.balances, s.goals, null, 222, "2026-10-06");
  assert.strictEqual(rec.amount, 115);
  assert.strictEqual(L.withdrawPlan(s.items, s.balances, s.goals, null).amount, 0);
  assert.ok(Object.values(s.balances).every((v) => v === 0));
});
test("a platform with nothing in it is blocked", () => {
  const s = shop();
  s.balances.eBay = 0;
  assert.ok(L.withdrawPlan(s.items, s.balances, s.goals, "eBay").blocked !== "");
});
test("undo restores items and balances", () => {
  const s = shop();
  const rec = L.applyWithdrawal(s.items, s.balances, s.goals, "Depop", 333, "2026-10-06");
  L.undoWithdrawal(s.items, s.balances, s.goals, rec);
  assert.strictEqual(L.withdrawPlan(s.items, s.balances, s.goals, "Depop").amount, 75);
  assert.strictEqual(s.balances.Depop, 5);
});
test("two withdrawals in a row, then undo only the last", () => {
  const s = shop();
  L.applyWithdrawal(s.items, s.balances, s.goals, "Depop", 1, "d");
  const second = L.applyWithdrawal(s.items, s.balances, s.goals, "Vinted", 2, "d");
  L.undoWithdrawal(s.items, s.balances, s.goals, second);
  assert.strictEqual(L.withdrawPlan(s.items, s.balances, s.goals, "Vinted").amount, 30);
  assert.strictEqual(L.withdrawPlan(s.items, s.balances, s.goals, "Depop").amount, 0);
});
test("purchased goals come out of the total", () => {
  const s = shop();
  s.goals = [{ amount: 40, purchased: true, settled: 0 }];
  assert.strictEqual(L.withdrawPlan(s.items, s.balances, s.goals, null).amount, 75);
});
test("per-platform withdrawal is blocked if it would leave goals unpaid", () => {
  const s = shop();
  s.goals = [{ amount: 100, purchased: true, settled: 0 }];
  const plan = L.withdrawPlan(s.items, s.balances, s.goals, "Depop");
  assert.ok(plan.blocked.indexOf("Total") !== -1);
});
test("total withdrawal settles purchased goals, and undo unsettles them", () => {
  const s = shop();
  s.goals = [{ amount: 40, purchased: true, settled: 0 }];
  const rec = L.applyWithdrawal(s.items, s.balances, s.goals, null, 9, "d");
  assert.strictEqual(s.goals[0].settled, 9);
  L.undoWithdrawal(s.items, s.balances, s.goals, rec);
  assert.strictEqual(s.goals[0].settled, 0);
});
console.log(passed + " tests passed" + (process.exitCode ? " (some failed)" : ""));

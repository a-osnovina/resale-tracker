// Run with: node tests/logic.test.js
const assert = require("assert");
const L = require("../logic.js");
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok  " + name); }
  catch (e) { console.error("FAIL  " + name + "\n      " + e.message); process.exitCode = 1; }
}
const sold = (o) => Object.assign({ status: "Sold", current: 40, soldFor: 40, cost: 10, bump: false }, o);

test("money formats and rounds", () => {
  assert.strictEqual(L.money(5), "$5.00");
  assert.strictEqual(L.money(-3.456), "-$3.46");
  assert.strictEqual(L.money(0.1 + 0.2), "$0.30");
});
test("profit with no fees is price minus cost", () => assert.strictEqual(L.profitOf(sold()), 30));
test("profit uses soldFor over current", () => assert.strictEqual(L.profitOf(sold({ soldFor: 35 })), 25));
test("old items without fee fields keep their old profit", () => assert.strictEqual(L.profitOf(sold({ feePercent: undefined })), 30));
test("percent bump comes off profit", () => assert.strictEqual(L.profitOf(sold({ bump: true, bumpRate: 12 })), 25.2));
test("flat bump comes off profit", () => assert.strictEqual(L.profitOf(sold({ bump: true, bumpAmount: 2 })), 28));
test("platform percent fee", () => assert.strictEqual(L.platformFee(sold({ feePercent: 10 })), 4));
test("platform percent + flat fee", () => assert.strictEqual(L.platformFee(sold({ feePercent: 10, feeFlat: 0.45 })), 4.45));
test("fee is rounded to the cent", () => assert.strictEqual(L.platformFee(sold({ soldFor: 12.34, feePercent: 13 })), 1.6));
test("platform fee is zero while not sold", () => assert.strictEqual(L.platformFee(sold({ status: "Listed", feePercent: 10 })), 0));
test("shipping label comes off profit", () => assert.strictEqual(L.profitOf(sold({ shipCost: 4.5 })), 25.5));
test("all costs together", () => {
  const it = sold({ bump: true, bumpAmount: 1, feePercent: 10, feeFlat: 0.5, shipCost: 5 });
  assert.strictEqual(L.costsTotal(it), 10.5);
  assert.strictEqual(L.profitOf(it), 19.5);
});
test("bad values are treated as zero", () => {
  assert.strictEqual(L.profitOf(sold({ feePercent: "abc", feeFlat: -3, shipCost: null })), 30);
});
test("profit can be negative", () => assert.strictEqual(L.profitOf(sold({ soldFor: 5, shipCost: 6 })), -11));
test("no float drift on sums", () => assert.strictEqual(L.profitOf(sold({ soldFor: 0.3, cost: 0.1, shipCost: 0.1 })), 0.1));
test("bulk split adds up exactly", () => {
  const parts = L.bulkCosts(3, 10);
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
test("paid investments come out of the total", () => {
  const s = shop();
  s.goals = [{ amount: 40, purchased: true, settled: 0 }];
  assert.strictEqual(L.withdrawPlan(s.items, s.balances, s.goals, null).amount, 75);
});
test("per-platform withdrawal is blocked if it would leave investments unpaid", () => {
  const s = shop();
  s.goals = [{ amount: 100, purchased: true, settled: 0 }];
  const plan = L.withdrawPlan(s.items, s.balances, s.goals, "Depop");
  assert.ok(plan.blocked.indexOf("Total") !== -1);
});
test("total withdrawal settles paid investments, and undo unsettles them", () => {
  const s = shop();
  s.goals = [{ amount: 40, purchased: true, settled: 0 }];
  const rec = L.applyWithdrawal(s.items, s.balances, s.goals, null, 9, "d");
  assert.strictEqual(s.goals[0].settled, 9);
  L.undoWithdrawal(s.items, s.balances, s.goals, rec);
  assert.strictEqual(s.goals[0].settled, 0);
});

// ---- investments that repeat ----
const rent = (o) => Object.assign({ name: "Rent", amount: 40, purchased: true, settled: 0, repeat: "monthly", repeatDay: 1, autoReset: true, cycle: "2026-09-01" }, o);
test("month helpers", () => {
  assert.strictEqual(L.monthOf("2026-10-06"), "2026-10");
  assert.strictEqual(L.monthLabel("2026-10"), "Oct 2026");
});
test("monthly period starts on the chosen day of the month", () => {
  assert.strictEqual(L.periodStart({ repeat: "monthly", repeatDay: 1 }, "2026-10-06"), "2026-10-01");
  assert.strictEqual(L.periodStart({ repeat: "monthly", repeatDay: 15 }, "2026-10-06"), "2026-09-15");
  assert.strictEqual(L.periodStart({ repeat: "monthly", repeatDay: 15 }, "2026-10-15"), "2026-10-15");
  assert.strictEqual(L.periodStart({ repeat: "monthly", repeatDay: 15 }, "2026-01-06"), "2025-12-15");
});
test("monthly day 31 uses the last day of shorter months", () => {
  assert.strictEqual(L.periodStart({ repeat: "monthly", repeatDay: 31 }, "2026-03-05"), "2026-02-28");
  assert.strictEqual(L.periodStart({ repeat: "monthly", repeatDay: 31 }, "2026-04-30"), "2026-04-30");
});
test("weekly period starts on the chosen weekday", () => {
  // 2026-10-06 is a Tuesday
  assert.strictEqual(L.periodStart({ repeat: "weekly", repeatDay: 1 }, "2026-10-06"), "2026-10-05");
  assert.strictEqual(L.periodStart({ repeat: "weekly", repeatDay: 2 }, "2026-10-06"), "2026-10-06");
  assert.strictEqual(L.periodStart({ repeat: "weekly", repeatDay: 5 }, "2026-10-06"), "2026-10-02");
  assert.strictEqual(L.periodStart({ repeat: "weekly", repeatDay: 0 }, "2026-10-06"), "2026-10-04");
});
test("daily and yearly periods", () => {
  assert.strictEqual(L.periodStart({ repeat: "daily" }, "2026-10-06"), "2026-10-06");
  assert.strictEqual(L.periodStart({ repeat: "yearly", repeatMonth: 3, repeatDay: 10 }, "2026-10-06"), "2026-03-10");
  assert.strictEqual(L.periodStart({ repeat: "yearly", repeatMonth: 12, repeatDay: 1 }, "2026-10-06"), "2025-12-01");
  assert.strictEqual(L.periodStart({ repeat: "none" }, "2026-10-06"), "");
});
test("schedule text and period labels", () => {
  assert.strictEqual(L.repeatText({ repeat: "monthly", repeatDay: 1 }), "Every month on the 1st");
  assert.strictEqual(L.repeatText({ repeat: "monthly", repeatDay: 22 }), "Every month on the 22nd");
  assert.strictEqual(L.repeatText({ repeat: "monthly", repeatDay: 31 }), "Every month on the last day");
  assert.strictEqual(L.repeatText({ repeat: "weekly", repeatDay: 5 }), "Every week on Friday");
  assert.strictEqual(L.repeatText({ repeat: "yearly", repeatMonth: 3, repeatDay: 10 }), "Every year on Mar 10");
  assert.strictEqual(L.repeatText({ repeat: "daily" }), "Every day");
  assert.strictEqual(L.repeatText({ repeat: "none" }), "");
  assert.strictEqual(L.periodLabel({ repeat: "monthly" }, "2026-09-01"), "Sep 2026");
  assert.strictEqual(L.periodLabel({ repeat: "weekly" }, "2026-10-05"), "week of Oct 5");
});
test("a new period resets a paid, auto-reset investment and keeps a paid record", () => {
  const goals = [rent()];
  const names = L.rolloverInvestments(goals, "2026-10-06");
  assert.deepStrictEqual(names, ["Rent"]);
  assert.strictEqual(goals.length, 2);
  assert.strictEqual(goals[0].purchased, false);
  assert.strictEqual(goals[0].cycle, "2026-10-01");
  assert.strictEqual(goals[1].purchased, true);
  assert.strictEqual(goals[1].name, "Rent (Sep 2026)");
  assert.strictEqual(goals[1].amount, 40);
  assert.strictEqual(goals[1].repeat, "none");
});
test("a weekly investment resets when the next due weekday arrives", () => {
  const goals = [rent({ repeat: "weekly", repeatDay: 1, cycle: "2026-09-28" })];
  assert.deepStrictEqual(L.rolloverInvestments(goals, "2026-10-04"), []);
  assert.deepStrictEqual(L.rolloverInvestments(goals, "2026-10-05"), ["Rent"]);
  assert.strictEqual(goals[1].name, "Rent (week of Sep 28)");
});
test("old saves that stored only the month still work", () => {
  const same = [rent({ cycle: "2026-10" })];
  assert.deepStrictEqual(L.rolloverInvestments(same, "2026-10-20"), []);
  const older = [rent({ cycle: "2026-09" })];
  assert.deepStrictEqual(L.rolloverInvestments(older, "2026-10-02"), ["Rent"]);
});
test("resetting keeps the money spent, so the balance does not jump back up", () => {
  const s = shop();
  s.goals = [rent()];
  assert.strictEqual(L.withdrawPlan(s.items, s.balances, s.goals, null).amount, 75);
  L.rolloverInvestments(s.goals, "2026-10-06");
  assert.strictEqual(L.withdrawPlan(s.items, s.balances, s.goals, null).amount, 75);
});
test("a total withdrawal after a reset settles the old paid record, and undo brings it back", () => {
  const s = shop();
  s.goals = [rent()];
  L.rolloverInvestments(s.goals, "2026-10-06");
  const rec = L.applyWithdrawal(s.items, s.balances, s.goals, null, 7, "d");
  assert.strictEqual(rec.amount, 75);
  assert.strictEqual(s.goals[1].settled, 7);
  assert.strictEqual(s.goals[0].settled, 0);
  L.undoWithdrawal(s.items, s.balances, s.goals, rec);
  assert.strictEqual(L.withdrawPlan(s.items, s.balances, s.goals, null).amount, 75);
});
test("no reset in the same period", () => {
  const goals = [rent({ cycle: "2026-10-01" })];
  assert.deepStrictEqual(L.rolloverInvestments(goals, "2026-10-06"), []);
  assert.strictEqual(goals[0].purchased, true);
});
test("no automatic reset when auto-reset is off", () => {
  const goals = [rent({ autoReset: false })];
  assert.deepStrictEqual(L.rolloverInvestments(goals, "2026-10-06"), []);
  assert.strictEqual(goals[0].purchased, true);
});
test("one-time investments never reset", () => {
  const goals = [rent({ repeat: "none" })];
  assert.deepStrictEqual(L.rolloverInvestments(goals, "2027-01-06"), []);
  assert.strictEqual(goals[0].purchased, true);
});
test("unpaid investments are left alone", () => {
  const goals = [rent({ purchased: false })];
  assert.deepStrictEqual(L.rolloverInvestments(goals, "2026-10-06"), []);
  assert.strictEqual(goals.length, 1);
});
test("skipping several periods resets once, labelled with the period it was paid", () => {
  const goals = [rent()];
  L.rolloverInvestments(goals, "2026-12-06");
  assert.strictEqual(goals.length, 2);
  assert.strictEqual(goals[1].name, "Rent (Sep 2026)");
  assert.strictEqual(goals[0].cycle, "2026-12-01");
});
test("a manual reset works even with auto-reset off, and an unpaid one just moves to the new period", () => {
  const goals = [rent({ autoReset: false })];
  L.resetInvestment(goals, goals[0], "2026-10-01");
  assert.strictEqual(goals.length, 2);
  assert.strictEqual(goals[0].purchased, false);
  const unpaid = [rent({ purchased: false })];
  L.resetInvestment(unpaid, unpaid[0], "2026-10-01");
  assert.strictEqual(unpaid.length, 1);
  assert.strictEqual(unpaid[0].cycle, "2026-10-01");
});
console.log(passed + " tests passed" + (process.exitCode ? " (some failed)" : ""));

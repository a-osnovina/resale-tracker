// Run with: node tests/profit.test.js
const assert = require("assert");
const L = require("../logic.js");
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok  " + name); }
  catch (e) { console.error("FAIL  " + name + "\n      " + e.message); process.exitCode = 1; }
}
const sale = (site, day, price, o) => Object.assign({ status: "Sold", site: site, sold: "2026-10-" + (day < 10 ? "0" : "") + day, current: price, soldFor: price, cost: 0 }, o);
const shop = () => [
  sale("Depop", 1, 21), sale("Depop", 3, 17.5), sale("Depop", 8, 12.5),
  sale("Vinted", 2, 10), sale("Vinted", 4, 5, { cost: 1 }),
  sale("Depop", 5, 40, { sold: "2026-09-05" }),
  { status: "Listed", site: "Depop", current: 99, soldFor: null, cost: 0 }
];

test("month helpers", () => {
  assert.strictEqual(L.prevMonth("2026-10"), "2026-09");
  assert.strictEqual(L.prevMonth("2026-01"), "2025-12");
  assert.strictEqual(L.nextMonth("2026-12"), "2027-01");
  assert.strictEqual(L.nextMonth("2026-09"), "2026-10");
  assert.strictEqual(L.daysIn("2026-02"), 28);
  assert.strictEqual(L.daysIn("2026-10"), 31);
});
test("only sold items in that month and platform are counted", () => {
  assert.strictEqual(L.soldInMonth(shop(), "2026-10", "All").length, 5);
  assert.strictEqual(L.soldInMonth(shop(), "2026-10", "Depop").length, 3);
  assert.strictEqual(L.soldInMonth(shop(), "2026-09", "All").length, 1);
});
test("table: sales minus costs equals profit", () => {
  const items = [sale("Depop", 1, 60, { feePercent: 10, bump: true, bumpAmount: 3, shipCost: 2, cost: 5 })];
  const t = L.profitTable(items, "2026-10", "All");
  assert.strictEqual(t.sales, 60);
  assert.strictEqual(t.fees, 6);
  assert.strictEqual(t.bump, 3);
  assert.strictEqual(t.ship, 2);
  assert.strictEqual(t.cost, 5);
  assert.strictEqual(t.profit, 44);
  assert.strictEqual(t.profit, L.profitOf(items[0]));
});
test("table for one platform leaves the others out", () => {
  assert.strictEqual(L.profitTable(shop(), "2026-10", "Depop").profit, 51);
  assert.strictEqual(L.profitTable(shop(), "2026-10", "Vinted").profit, 14);
  assert.strictEqual(L.profitTable(shop(), "2026-10", "All").profit, 65);
});
test("empty month gives zeros", () => {
  const t = L.profitTable(shop(), "2026-08", "All");
  assert.strictEqual(t.count, 0);
  assert.strictEqual(t.profit, 0);
});
test("running total adds up day by day and stays flat on quiet days", () => {
  assert.deepStrictEqual(L.cumulativeProfit(shop(), "2026-10", "Depop", 8), [21, 21, 38.5, 38.5, 38.5, 38.5, 38.5, 51]);
});
test("running total only goes up to the chosen day", () => {
  assert.deepStrictEqual(L.cumulativeProfit(shop(), "2026-10", "Depop", 3), [21, 21, 38.5]);
});
test("last value of the running total matches the table", () => {
  const run = L.cumulativeProfit(shop(), "2026-10", "All", 31);
  assert.strictEqual(run[30], L.profitTable(shop(), "2026-10", "All").profit);
});
test("no float drift in the running total", () => {
  const items = [sale("Depop", 1, 0.1), sale("Depop", 2, 0.2)];
  assert.strictEqual(L.cumulativeProfit(items, "2026-10", "All", 2)[1], 0.3);
});
console.log(passed + " profit tests passed" + (process.exitCode ? " (some failed)" : ""));

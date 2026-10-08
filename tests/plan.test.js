// Run with: node tests/plan.test.js
const assert = require("assert");
const L = require("../logic.js");
function test(name, fn) {
  try { fn(); console.log("  ok  " + name); }
  catch (e) { console.error("FAIL  " + name + "\n      " + e.message); process.exitCode = 1; }
}
// 0 = Mon ... 6 = Sun
test("no shipping days chosen gives no waits", () => {
  assert.strictEqual(L.shipWaits([]), null);
});
test("Tue + Fri: waits match the design (Tue sale waits 3)", () => {
  assert.deepStrictEqual(L.shipWaits([1, 4]), [1, 3, 2, 1, 2, 2, 2]);
});
test("Tue + Fri with a 2 day limit: only Tuesday is late, Wed or Thu fixes it", () => {
  const c = L.shipCoverage([1, 4], 2);
  assert.deepStrictEqual(c.late, [1]);
  assert.deepStrictEqual(c.fixes, [2, 3]);
});
test("shipping every weekday is never late", () => {
  const c = L.shipCoverage([0, 1, 2, 3, 4], 2);
  assert.deepStrictEqual(c.late, []);
  assert.deepStrictEqual(c.fixes, []);
});
test("a higher limit removes the warning", () => {
  assert.deepStrictEqual(L.shipCoverage([1, 4], 3).late, []);
});
const sold = (day, price, posted) => ({ status: "Sold", sold: day, posted: posted, current: price, soldFor: price });
test("salesStats uses only the last 90 days", () => {
  const items = [sold("2026-10-01", 20, "2026-09-10"), sold("2026-09-20", 30, "2026-09-01"), sold("2026-09-01", 40, "2026-08-10"), sold("2026-01-01", 500, "2025-12-01")];
  const s = L.salesStats(items, "2026-10-08", 90, 3);
  assert.strictEqual(s.count, 3);
  assert.strictEqual(s.avgPrice, 30);
  assert.strictEqual(s.enough, true);
  assert.strictEqual(s.daysToSell, 21);
});
test("salesStats falls back to sample numbers with too little history", () => {
  const s = L.salesStats([], "2026-10-08", 90, 0);
  assert.strictEqual(s.enough, false);
  assert.strictEqual(s.daysToSell, 21);
  assert.ok(Math.abs(s.sellRate - 1 / 3) < 1e-9);
});
test("earnedSince counts sales from the goal start", () => {
  const items = [sold("2026-10-02", 20.5), sold("2026-10-05", 10), sold("2026-09-01", 99)];
  assert.strictEqual(L.earnedSince(items, "2026-10-01", "2026-10-08"), 30.5);
});
test("goalPlan: $200 goal, $48 earned, $25 average", () => {
  const g = L.goalPlan({ goal: 200, earned: 48, avgPrice: 25, sellRate: 1 / 3, listedNow: 3, daysToSell: 21, by: "2026-11-15", today: "2026-10-08", minutesPerItem: 60 });
  assert.strictEqual(g.remaining, 152);
  assert.strictEqual(g.salesNeeded, 7);
  assert.strictEqual(g.expected, 1);
  assert.strictEqual(g.listingsNeeded, 18);
  assert.strictEqual(g.listBy, "2026-10-25");
  assert.strictEqual(g.weeksLeft, 3);
  assert.strictEqual(g.perWeek, 6);
  assert.strictEqual(g.hours, 18);
});
test("goalPlan: already reached", () => {
  const g = L.goalPlan({ goal: 100, earned: 120, avgPrice: 25, sellRate: 0.5, listedNow: 0, daysToSell: 14, by: "2026-11-01", today: "2026-10-08", minutesPerItem: 60 });
  assert.strictEqual(g.done, true);
  assert.strictEqual(g.perWeek, 0);
});
test("goalPlan: too late to list in time", () => {
  const g = L.goalPlan({ goal: 200, earned: 0, avgPrice: 20, sellRate: 0.5, listedNow: 0, daysToSell: 21, by: "2026-10-15", today: "2026-10-08", minutesPerItem: 60 });
  assert.strictEqual(g.tooLate, true);
});
test("priceOptions", () => {
  assert.deepStrictEqual(L.priceOptions(152, [15, 25, 40]).map(o => o.sales), [11, 7, 4]);
});

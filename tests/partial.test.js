// Run with: node tests/partial.test.js
const assert = require("assert");
const L = require("../logic.js");
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok  " + name); }
  catch (e) { console.error("FAIL  " + name + "\n      " + e.message); process.exitCode = 1; }
}
const done = (site, price) => ({ status: "Sold", site: site, current: price, soldFor: price, cost: 0 });
// Depop 75 (5 start + 70 sales), Vinted 30, eBay 10 start => 115 in total
const shop = () => ({
  items: [done("Depop", 50), done("Depop", 20), done("Vinted", 30)],
  balances: { Depop: 5, Vinted: 0, eBay: 10 },
  goals: [],
  history: []
});
const take = (s, platform, amount, id) => {
  const rec = L.partialWithdrawal(s.items, s.balances, s.goals, platform, amount, id, "2026-10-08", s.history);
  if (rec) s.history.push(rec);
  return rec;
};
const avail = (s, platform) => L.withdrawPlan(s.items, s.balances, s.goals, platform, s.history).amount;

test("a chosen amount from one platform comes off that platform and the total", () => {
  const s = shop();
  const rec = take(s, "Depop", 25, 1);
  assert.strictEqual(rec.amount, 25);
  assert.deepStrictEqual(rec.parts, { Depop: 25 });
  assert.strictEqual(avail(s, "Depop"), 50);
  assert.strictEqual(avail(s, "Vinted"), 30);
  assert.strictEqual(avail(s, null), 90);
});
test("the sales stay untouched by a partial withdrawal", () => {
  const s = shop();
  take(s, "Depop", 25, 1);
  assert.ok(s.items.every((it) => !it.withdrawn));
  assert.strictEqual(s.balances.Depop, 5);
});
test("you cannot take more than the platform holds, or zero", () => {
  const s = shop();
  assert.strictEqual(take(s, "Depop", 75.01, 1), null);
  assert.strictEqual(take(s, "Depop", 0, 2), null);
  assert.strictEqual(take(s, "Depop", -5, 3), null);
  assert.ok(take(s, "Depop", 75, 4));
  assert.strictEqual(avail(s, "Depop"), 0);
});
test("from all platforms the biggest platform is used first", () => {
  const s = shop();
  const rec = take(s, null, 80, 1);
  assert.deepStrictEqual(rec.parts, { Depop: 75, Vinted: 5 });
  assert.strictEqual(avail(s, null), 35);
  assert.strictEqual(avail(s, "Depop"), 0);
  assert.strictEqual(avail(s, "Vinted"), 25);
});
test("parts always add up to the amount", () => {
  const s = shop();
  const rec = take(s, null, 99.99, 1);
  const sum = Object.values(rec.parts).reduce((a, b) => a + Math.round(b * 100), 0);
  assert.strictEqual(sum, 9999);
});
test("the most you can take from everything is the whole balance", () => {
  const s = shop();
  assert.strictEqual(L.withdrawMax(s.items, s.balances, s.goals, null, s.history), 115);
  assert.strictEqual(take(s, null, 115.01, 1), null);
  assert.ok(take(s, null, 115, 2));
  assert.strictEqual(avail(s, null), 0);
});
test("paid investments limit what you can take", () => {
  const s = shop();
  s.goals = [{ amount: 100, purchased: true, settled: 0 }];
  assert.strictEqual(L.withdrawMax(s.items, s.balances, s.goals, null, s.history), 15);
  assert.strictEqual(L.withdrawMax(s.items, s.balances, s.goals, "Depop", s.history), 15);
  assert.strictEqual(take(s, "Depop", 20, 1), null);
  assert.ok(take(s, "Depop", 15, 2));
});
test("a full withdrawal after a partial pays out only what is left", () => {
  const s = shop();
  take(s, "Depop", 25, 1);
  const rec = L.applyWithdrawal(s.items, s.balances, s.goals, null, 2, "d", s.history);
  assert.strictEqual(rec.amount, 90);
  assert.strictEqual(avail(s, null), 0);
  assert.strictEqual(avail(s, "Depop"), 0);
});
test("a full withdrawal of one platform settles only its part of an earlier partial", () => {
  const s = shop();
  take(s, null, 80, 1); // Depop 75, Vinted 5
  const rec = L.applyWithdrawal(s.items, s.balances, s.goals, "Vinted", 2, "d", s.history);
  assert.strictEqual(rec.amount, 25);
  assert.strictEqual(avail(s, "Vinted"), 0);
  assert.strictEqual(avail(s, "Depop"), 0);
  assert.strictEqual(avail(s, null), 10); // eBay's 10 is all that is left
});
test("undoing a full withdrawal brings the partial back too", () => {
  const s = shop();
  take(s, "Depop", 25, 1);
  const rec = L.applyWithdrawal(s.items, s.balances, s.goals, null, 2, "d", s.history);
  L.undoWithdrawal(s.items, s.balances, s.goals, rec, s.history);
  assert.strictEqual(avail(s, null), 90);
  assert.strictEqual(avail(s, "Depop"), 50);
});
test("undoing a partial is just removing its record", () => {
  const s = shop();
  const rec = take(s, "Depop", 25, 1);
  L.undoWithdrawal(s.items, s.balances, s.goals, rec, s.history);
  s.history.pop();
  assert.strictEqual(avail(s, "Depop"), 75);
  assert.strictEqual(avail(s, null), 115);
});
test("two partials in a row add up", () => {
  const s = shop();
  take(s, "Depop", 25, 1);
  take(s, "Depop", 25, 2);
  assert.strictEqual(avail(s, "Depop"), 25);
  assert.strictEqual(L.takenMoney(s.history, "Depop"), 5000);
});
test("old calls without a history still work", () => {
  const s = shop();
  assert.strictEqual(L.withdrawPlan(s.items, s.balances, s.goals, null).amount, 115);
});
console.log(passed + " partial withdrawal tests passed" + (process.exitCode ? " (some failed)" : ""));

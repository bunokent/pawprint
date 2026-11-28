import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const page = readFileSync(
  new URL("../src/features/flyers/pages/RecentlyDeletedPage.tsx", import.meta.url),
  "utf8",
).replace(/\r\n/g, "\n");

/** Only the phone breakpoint that carries the Recently Deleted rules. */
function phoneRules() {
  const marker = "  .deleted-toolbar {\n    flex-direction: column;";
  const sheet = css.indexOf(marker);
  assert.notEqual(sheet, -1, "Recently Deleted needs a phone toolbar rule");
  const start = css.lastIndexOf("@media (max-width: 640px) {", sheet);
  assert.notEqual(start, -1, "the toolbar rule needs a phone breakpoint");
  return css.slice(start, css.indexOf("\n}", start));
}

test("Recently Deleted renders semantic cards instead of inline flex rows", () => {
  assert.match(page, /className="card deleted-card/);
  assert.match(page, /className="photo-frame deleted-card__photo"/);
  assert.match(page, /className="deleted-card__body"/);
  assert.match(page, /className="deleted-card__actions no-print"/);
  assert.doesNotMatch(page, /className="card deleted-row"/);
  assert.doesNotMatch(page, /style=\{\{ display: "flex", alignItems: "center", gap: 14/);
});

test("every hook runs before the auth redirect guard", () => {
  const guard = page.lastIndexOf("if (checked && !user) {");
  assert.notEqual(guard, -1, "the auth guard must still redirect guests");
  const before = page.slice(0, guard);
  assert.match(before, /useState<Set<string>>\(new Set\(\)\)/);
  assert.match(before, /useState<PendingAction \| null>\(null\)/);
  assert.match(before, /useMutation\(\{/);
});

test("the deleted flyer card keeps the mode accent and a 44px selection target", () => {
  assert.match(page, /data-mode=\{flyer\.mode \?\? "outreach"\}/);
  assert.match(page, /className="pp-check-label deleted-card__select"/);
  assert.match(css, /\.deleted-card\[data-mode="emergency"\]/);
  assert.match(css, /\.deleted-card\[data-mode="found"\]/);
  assert.match(css, /\.deleted-card__select\s*\{[^}]*width:\s*44px;\s*height:\s*44px/);
  assert.match(css, /\.deleted-card__actions\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
});

test("desktop card and confirmation actions wrap instead of overlapping", () => {
  const cardButton = css.match(/\.deleted-card__actions \.btn\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(cardButton, /white-space:\s*normal/);
  assert.match(cardButton, /min-height:\s*44px/);
  assert.match(css, /\.confirm-dialog\s*\{\s*width:\s*min\(520px, 100%\)/);
  assert.match(css, /\.confirm-dialog__actions\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(css, /\.confirm-dialog__actions \.btn\s*\{[^}]*white-space:\s*normal/);
});

test("on phones the toolbar, grid and cards stack without shrinking tap targets", () => {
  const rules = phoneRules();
  assert.match(rules, /\.deleted-toolbar\s*\{[^}]*flex-direction:\s*column/);
  assert.match(rules, /\.deleted-toolbar__actions\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(rules, /\.deleted-toolbar__actions \.btn\s*\{[^}]*min-height:\s*44px/);
  assert.match(rules, /\.deleted-grid\s*\{\s*grid-template-columns:\s*1fr/);
  assert.match(rules, /\.deleted-card__body\s*\{\s*padding:\s*16px/);
  assert.match(rules, /\.deleted-card__actions\s*\{\s*padding:\s*0 16px 16px/);
});

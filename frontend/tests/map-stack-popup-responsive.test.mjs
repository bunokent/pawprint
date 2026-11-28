import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
const page = readFileSync(new URL("../src/pages/PetMapPage.tsx", import.meta.url), "utf8");

/** Only the rules inside the shared phone breakpoint that carries the map rules. */
function phoneRules() {
  const sheet = css.indexOf(".map-popup--stack { bottom: 12px; left: 12px; right: 12px;");
  assert.notEqual(sheet, -1, "the stack card needs a phone bottom-sheet rule");
  const start = css.lastIndexOf("@media (max-width: 640px) {", sheet);
  assert.notEqual(start, -1, "the map rules need a phone breakpoint");
  return css.slice(start, css.indexOf("\n}", start));
}

test("stack popup markup uses semantic row classes instead of inline flex layout", () => {
  assert.match(page, /className="map-popup__header"/);
  assert.match(page, /className="map-stack-list"/);
  assert.match(page, /className="map-stack-row"/);
  assert.match(page, /className="map-stack-row__info"/);
  assert.match(page, /className="map-stack-row__name"/);
  assert.match(page, /className="map-popup__action map-stack-row__action"/);
  assert.doesNotMatch(page, /flexDirection:\s*"column",\s*gap:\s*6/, "the old inline stack list is gone");
});

test("each stacked pet is a CSS grid row with a compact desktop Open button", () => {
  assert.match(css, /\.map-stack-row\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*38px minmax\(0, 1fr\) auto/);
  assert.match(css, /\.map-stack-row \.map-popup__action\s*\{[^}]*min-width:\s*0/);
});

test("the stack card clips its header and scrolls only the flyer rows", () => {
  assert.match(css, /\.map-popup--stack\s*\{[^}]*max-height:\s*min\(400px, 84%\)[^}]*overflow:\s*hidden/);
  assert.match(css, /\.map-stack-list\s*\{[^}]*min-height:\s*0[^}]*overflow-y:\s*auto/);
  assert.match(css, /\.map-popup__header \.map-popup__close\s*\{[^}]*margin-left:\s*auto/);
});

test("on phones the card is a bottom sheet and Open spans the full row at 44px", () => {
  const rules = phoneRules();
  assert.match(rules, /\.map-popup--stack\s*\{[^}]*bottom:\s*12px[^}]*left:\s*12px[^}]*right:\s*12px/);
  assert.match(rules, /\.map-stack-row\s*\{[^}]*grid-template-columns:\s*44px minmax\(0, 1fr\)/);
  assert.match(rules, /\.map-stack-row \.map-stack-row__photo\s*\{[^}]*width:\s*44px[^}]*height:\s*44px/);
  assert.match(rules, /\.map-stack-row \.map-popup__action\s*\{[^}]*grid-column:\s*1 \/ -1/);
  assert.match(rules, /\.map-popup__action\s*\{[^}]*width:\s*100%[^}]*height:\s*44px/);
});

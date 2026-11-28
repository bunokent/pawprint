import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
const myFlyers = readFileSync(
  new URL("../src/features/flyers/pages/MyFlyersPage.tsx", import.meta.url),
  "utf8",
);
const flyerCard = readFileSync(
  new URL("../src/components/FlyerCard.tsx", import.meta.url),
  "utf8",
);

test("My Flyers grid stretches grid items so every row has one height", () => {
  assert.match(css, /\.my-flyers-grid\s*\{\s*display:\s*grid/,
    ".my-flyers-grid must be a CSS grid (default align-items: stretch equalizes row heights)");
});

test("OwnerFlyerCard wrapper is a flex column that fills the grid cell", () => {
  assert.match(myFlyers, /display:\s*"flex",\s*flexDirection:\s*"column"/,
    "OwnerFlyerCard wrapper must be a flex column");
});

test("FlyerCard grows to fill the wrapper so all cards in a row share one height", () => {
  assert.match(flyerCard, /<article\s+className="card flyer-card"\s+style=\{\{\s*flex:\s*1/,
    "FlyerCard article must use flex: 1 so it stretches to the row height");
});

import assert from "node:assert/strict";
import test from "node:test";

import { hasPhotoInput, isFlyerEditable, isFlyerOwner, tagsText, toDateTimeLocal, toIsoDateTime } from "../.test-build/edit-helpers.js";

test("only the flyer's creator may edit it", () => {
  const flyer = { creator: "owner-1" };
  assert.equal(isFlyerOwner(flyer, { id: "owner-1" }), true);
  assert.equal(isFlyerOwner(flyer, { id: "someone-else" }), false);
  assert.equal(isFlyerOwner(flyer, null), false);
  assert.equal(isFlyerOwner(null, { id: "owner-1" }), false);
});

test("ISO timestamps round-trip through the datetime-local field", () => {
  const local = new Date(2026, 10, 26, 14, 5); // 26 Nov 2026, 14:05 local time
  assert.equal(toDateTimeLocal(local.toISOString()), "2026-11-26T14:05");
  assert.equal(toIsoDateTime("2026-11-26T14:05"), local.toISOString());
});

test("empty and invalid dates do not produce broken input values", () => {
  assert.equal(toDateTimeLocal(null), "");
  assert.equal(toDateTimeLocal("not-a-date"), "");
  assert.equal(toIsoDateTime(""), null);
  assert.equal(toIsoDateTime("not-a-date"), null);
});

test("pet tags round-trip through the comma-separated form field", () => {
  assert.equal(tagsText(["calm", "good with kids"]), "calm, good with kids");
  assert.equal(tagsText(["", "  ", null, "friendly"]), "friendly");
  assert.equal(tagsText("not-an-array"), "");
});

test("a photo key is required before an update can be saved", () => {
  assert.equal(hasPhotoInput("flyers/owner/losts/photo.jpg"), true);
  assert.equal(hasPhotoInput(""), false);
  assert.equal(hasPhotoInput("   "), false);
  assert.equal(hasPhotoInput(null), false);
  assert.equal(hasPhotoInput(undefined), false);
});

test("resolved flyers cannot be edited", () => {
  assert.equal(isFlyerEditable({ status: "resolved" }), false);
  assert.equal(isFlyerEditable({ status: "active" }), true);
  assert.equal(isFlyerEditable({ status: "generating" }), true);
  assert.equal(isFlyerEditable(null), false);
});

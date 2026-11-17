// The extension's ranking is the app's file, copied. This fails when the two differ: run `npm run sync`.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("the extension's ranking is the app's ranking", () => {
  assert.equal(
    readFileSync("../raycast/src/ranking.ts", "utf8"),
    readFileSync("../../src/lib/ranking.ts", "utf8"),
  );
});

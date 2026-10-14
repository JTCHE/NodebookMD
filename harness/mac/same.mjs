// Whether two BMP screenshots (from `sips -s format bmp`) show the same
// picture. A re-drawn page differs by a level here and there from
// antialiasing, so a pixel counts as changed only past a small step.
// Usage: node same.mjs a.bmp b.bmp — exit 0 when the same.
import { readFileSync } from "node:fs";
const [a, b] = process.argv.slice(2).map((path) => readFileSync(path));
const pixels = (bmp) => bmp.subarray(bmp.readUInt32LE(10));
const [pa, pb] = [pixels(a), pixels(b)];
let changed = 0;
for (let i = 0; i < Math.min(pa.length, pb.length); i += 1) if (Math.abs(pa[i] - pb[i]) > 8) changed += 1;
if (pa.length !== pb.length) changed += Math.abs(pa.length - pb.length);
console.log(`${changed} channel values changed`);
process.exit(changed === 0 ? 0 : 1);

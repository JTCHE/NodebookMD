#!/usr/bin/env bun
/**
 * Skip-if-unchanged sync of the OpenNext incremental cache to the R2 cache
 * bucket (`houdinimd-cache`), plus orphan pruning.
 *
 * Replaces OpenNext's built-in deploy populate step, which PUTs every one of
 * the ~21k cache assets unconditionally on every deploy (~21k R2 Class A ops)
 * and never deletes stale entries. With a pinned BUILD_ID (see next.config.ts)
 * the cache keys are stable across deploys, so here we:
 *   1. List what's already in R2 (bulk, ~22 Class A "list" ops for the whole
 *      bucket — far cheaper than per-object HEADs).
 *   2. Upload ONLY assets whose content differs. Fast path: R2 etag = md5 of
 *      the stored bytes, compared to our local gzip's md5. Entries the worker
 *      rewrote at runtime gzip differently, so those get one HEAD each and are
 *      compared on the `srchash` metadata (hash of the uncompressed source)
 *      instead. A content-stable deploy uploads nothing.
 *
 * Only `.cache` entries are synced. Next can also write a `__fetch/` cache,
 * which the runtime never reads.
 *   3. Delete orphans — any object under the prefix that no current asset maps
 *      to. This reclaims old random-build-id prefixes and removed pages.
 *
 * Objects are stored gzipped, and `.cache` entries have the duplicate
 * `segmentData["/_full"]` removed — see lib/cache/compressed-r2-cache.ts, which
 * is the runtime half of the same format. Keys are computed identically to
 * OpenNext's runtime R2 cache (`computeCacheKey`:
 * `${prefix}/${buildId}/${sha256(key)}.${cacheType}`), so the worker reads
 * exactly what this writes.
 *
 * Auth: a dedicated R2 token scoped to the cache bucket, via env
 *   R2_CACHE_ACCESS_KEY_ID / R2_CACHE_SECRET_ACCESS_KEY
 * (the existing R2_ACCESS_KEY_ID is scoped to the docs bucket only). The
 * account id / endpoint is shared (CF_ACCOUNT_ID). These are only needed
 * locally at deploy time — the deployed worker uses the R2 binding, not S3.
 *
 * Usage:
 *   bun scripts/cache-sync.ts            # dry-run: report uploads/deletes
 *   bun scripts/cache-sync.ts --apply    # perform uploads + deletes
 *   bun scripts/cache-sync.ts --apply --no-prune   # upload only, keep orphans
 *   bun scripts/cache-sync.ts --apply --no-upload  # prune only, write nothing
 */

import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  S3Client,
  ListObjectsV2Command,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { parseArgs, c, fmtPct } from "./lib/cli";
import { docPages } from "../lib/doc-pages";
import { TITLES_KEY } from "../lib/notice";

const BUCKET = "houdinimd-cache";
const CACHE_DIR = path.join(process.cwd(), ".open-next", "cache");
// Must match the runtime: OpenNext defaults the prefix to "incremental-cache"
// when NEXT_INC_CACHE_R2_PREFIX is unset (it is unset here).
const PREFIX = process.env.NEXT_INC_CACHE_R2_PREFIX || "incremental-cache";
const CONCURRENCY = 32;

interface CacheAsset {
  fullPath: string;
  /** R2 object key, identical to what the runtime computes. */
  key: string;
  /** The route this entry holds, for the log. */
  path: string;
}

/** Mirror of OpenNext's computeCacheKey. */
function computeCacheKey(key: string, buildId: string): string {
  const hash = createHash("sha256").update(key).digest("hex");
  return `${PREFIX}/${buildId}/${hash}.cache`.replace(/\/+/g, "/");
}

/**
 * Enumerate local cache assets, mirroring OpenNext's getCacheAssets path
 * parsing so the derived keys match the runtime exactly.
 */
function collectAssets(): CacheAsset[] {
  let entries: string[];
  try {
    entries = readdirSync(CACHE_DIR, { recursive: true, encoding: "utf8" });
  } catch {
    throw new Error(
      `Cache dir not found at ${CACHE_DIR}. Run \`opennextjs-cloudflare build\` first.`,
    );
  }
  const assets: CacheAsset[] = [];
  for (const rel of entries) {
    const fullPath = path.join(CACHE_DIR, rel);
    const relPath = rel.split(path.sep).join("/");
    if (relPath.endsWith(".cache")) {
      const [buildId, ...keyParts] = relPath.slice(0, -".cache".length).split("/");
      if (!buildId || keyParts.length === 0) continue;
      const routePath = `/${keyParts.join("/")}`;
      assets.push({
        fullPath,
        key: computeCacheKey(routePath, buildId),
        path: routePath,
      });
    }
    // everything else (directories) is skipped
  }
  return assets;
}

function md5(buf: Buffer): string {
  return createHash("md5").update(buf).digest("hex");
}

/** Source bytes for an asset, with the duplicate segment removed. */
function sourceFor(a: CacheAsset): Buffer {
  const raw = readFileSync(a.fullPath);
  try {
    const entry = JSON.parse(raw.toString("utf8"));
    // `segmentData["/_full"]` is a byte-for-byte copy of `rsc`, ~400 KB on a
    // large doc page. Null it out here; lib/cache/compressed-r2-cache.ts
    // restores it on read. Must stay identical to `shrink()` there.
    if (entry?.segmentData?.["/_full"] !== undefined && entry.segmentData["/_full"] === entry.rsc) {
      return Buffer.from(
        JSON.stringify({ ...entry, segmentData: { ...entry.segmentData, "/_full": null } }),
      );
    }
    return raw;
  } catch {
    return raw; // not the shape we expect — store it untouched
  }
}

/**
 * What actually lands in R2: the source bytes, gzipped, plus the hash of the
 * *uncompressed* source. The worker writes the same shape (contentEncoding
 * gzip, `srchash` metadata) but with a different gzip implementation, so the
 * hash — not the R2 etag — is what tells us an entry is already current.
 */
function bodyFor(a: CacheAsset): { body: Buffer; srchash: string } {
  const source = sourceFor(a);
  return {
    body: gzipSync(source, { level: 9 }),
    srchash: createHash("sha256").update(source).digest("hex"),
  };
}

function makeClient(): S3Client {
  const accountId = process.env.CF_ACCOUNT_ID;
  const accessKeyId = process.env.R2_CACHE_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_CACHE_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "Missing R2 cache credentials. Set CF_ACCOUNT_ID, R2_CACHE_ACCESS_KEY_ID, " +
        "R2_CACHE_SECRET_ACCESS_KEY (cache-bucket-scoped token) in .env.local.",
    );
  }
  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
}

/** List every object under a prefix, returning key -> etag (md5, unquoted). */
async function listRemote(client: S3Client, prefix: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let token: string | undefined;
  let calls = 0;
  do {
    const res = await client.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    calls++;
    for (const o of res.Contents ?? []) {
      if (o.Key) map.set(o.Key, (o.ETag ?? "").replace(/"/g, ""));
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  console.log(c.dim(`  listed ${map.size} remote objects in ${calls} list call(s)`));
  return map;
}

// --- static chunk archive (P1 defense-in-depth against deleted-chunk 404s) ---
// Content-hashed /_next/static/{chunks,css,media} files, archived under
// static-archive/ so worker.ts can serve old-deploy chunks that a
// still-being-revalidated stale HTML/RSC response references but Workers
// Assets (current-deploy-only) no longer has. Immutable filenames — existence
// check is enough, no etag diff or pruning needed (see worker.ts).
const STATIC_ASSETS_DIR = path.join(process.cwd(), ".open-next", "assets", "_next", "static");
const STATIC_ARCHIVE_PREFIX = "static-archive/_next/static";
const STATIC_ARCHIVE_SUBDIRS = ["chunks", "css", "media"];

interface StaticAsset {
  fullPath: string;
  key: string;
}

function collectStaticAssets(): StaticAsset[] {
  const assets: StaticAsset[] = [];
  for (const sub of STATIC_ARCHIVE_SUBDIRS) {
    const dir = path.join(STATIC_ASSETS_DIR, sub);
    let entries: string[];
    try {
      entries = readdirSync(dir, { recursive: true, encoding: "utf8" });
    } catch {
      continue; // subdir may not exist for every build
    }
    for (const rel of entries) {
      const fullPath = path.join(dir, rel);
      if (!statSync(fullPath).isFile()) continue;
      const relPath = rel.split(path.sep).join("/");
      assets.push({ fullPath, key: `${STATIC_ARCHIVE_PREFIX}/${sub}/${relPath}` });
    }
  }
  return assets;
}

async function syncStaticArchive(client: S3Client) {
  console.log("");
  console.log(c.bold("Static chunk archive"));
  const assets = collectStaticAssets();
  console.log(`  local assets ${assets.length}`);
  const remote = await listRemote(client, `${STATIC_ARCHIVE_PREFIX}/`);
  const toUpload = assets.filter((a) => !remote.has(a.key));
  console.log(`  ${c.green("upload")}  ${toUpload.length} / ${assets.length} new (content-hashed, existing ones are immutable)`);
  let uploaded = 0;
  await pool(toUpload, CONCURRENCY, async (a) => {
    await client.send(new PutObjectCommand({ Bucket: BUCKET, Key: a.key, Body: readFileSync(a.fullPath) }));
    uploaded++;
  });
  console.log(`  archived ${uploaded}/${toUpload.length}`);
}

/**
 * The title map the Worker fills each doc notice from (lib/notice.ts). Outside
 * the cache prefix, so the prune leaves it alone. One HEAD, and a PUT only
 * when a title changed.
 */
async function syncTitles(client: S3Client) {
  const body = gzipSync(JSON.stringify(Object.fromEntries(await docPages())), { level: 9 });
  const etag = await client
    .send(new HeadObjectCommand({ Bucket: BUCKET, Key: TITLES_KEY }))
    .then((head) => (head.ETag ?? "").replace(/"/g, ""))
    .catch(() => "");
  if (etag === md5(body)) return console.log(c.dim(`  titles      unchanged`));
  await client.send(
    new PutObjectCommand({ Bucket: BUCKET, Key: TITLES_KEY, Body: body, ContentEncoding: "gzip", ContentType: "application/json" }),
  );
  console.log(`  titles      uploaded ${body.length}B`);
}

/** Run async tasks with bounded concurrency. */
async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]);
    }
  });
  await Promise.all(workers);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apply = args.flags.has("apply");
  const prune = !args.flags.has("no-prune");
  // Pruning needs no knowledge of the upload diff — an orphan is any remote key
  // no local asset maps to. Skipping the diff skips gzipping every asset twice
  // and every HEAD, so a prune-only pass costs the list calls and nothing else.
  const upload = !args.flags.has("no-upload");

  console.log(c.bold("HoudiniMD cache sync"));
  console.log(`  bucket      ${BUCKET}`);
  console.log(`  prefix      ${PREFIX}/`);
  console.log(`  mode        ${apply ? c.red("--apply (writes to R2)") : c.dim("dry-run (pass --apply to commit)")}`);
  console.log(`  prune       ${prune ? "on" : c.yellow("off (--no-prune)")}`);
  console.log(`  upload      ${upload ? "on" : c.yellow("off (--no-upload)")}`);
  console.log("");

  const client = makeClient();
  const assets = collectAssets();
  console.log(`  local assets ${assets.length}`);
  const remote = await listRemote(client, `${PREFIX}/`);

  // Diff. An asset needs upload if remote is missing it or the etag differs.
  // (A multipart etag contains "-"; our objects are single-part, so any "-"
  // forces a re-upload, which is safe.)
  const valid = new Set<string>(assets.map((a) => a.key));
  const candidates: CacheAsset[] = upload
    ? assets.filter((a) => remote.get(a.key) !== md5(bodyFor(a).body))
    : [];
  // An etag mismatch is not proof of a content change: entries the worker
  // rewrote at runtime hold the same JSON compressed by a different gzip, so
  // their etag never matches ours. HEAD those (Class B, 12x cheaper than the
  // PUT it saves) and compare the source hash before deciding to upload.
  const toUpload: CacheAsset[] = [];
  let skippedByHash = 0;
  await pool(candidates, CONCURRENCY, async (a) => {
    if (!remote.has(a.key)) return void toUpload.push(a);
    try {
      const head = await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: a.key }));
      if (head.Metadata?.srchash === bodyFor(a).srchash) return void skippedByHash++;
    } catch {
      // fall through and upload
    }
    toUpload.push(a);
  });
  const toDelete = prune
    ? [...remote.keys()].filter((k) => !valid.has(k))
    : [];

  console.log("");
  console.log(`  ${c.green("upload")}  ${toUpload.length} / ${assets.length} (${fmtPct(toUpload.length, assets.length)} changed)`);
  if (skippedByHash) console.log(c.dim(`          ${skippedByHash} unchanged despite a new etag (worker-written, matched on srchash)`));
  // Which routes changed, not just how many. A deploy that touches no content
  // should upload almost nothing; when it does not, this names the pages to
  // look at. Six is enough to see a shape and short enough to read in a build log.
  if (toUpload.length) {
    const fresh = toUpload.filter((a) => !remote.has(a.key)).length;
    console.log(c.dim(`          ${fresh} new, ${toUpload.length - fresh} rewritten; e.g. ${toUpload.slice(0, 6).map((a) => a.path).join(" ")}`));
  }
  console.log(`  ${c.red("delete")}  ${toDelete.length} orphan(s)`);

  if (!apply) {
    console.log("");
    console.log(c.dim("  dry-run — nothing written. Re-run with --apply to commit."));
    if (toDelete.length) {
      console.log(c.dim("  sample orphan keys:"));
      toDelete.slice(0, 5).forEach((k) => console.log(c.dim(`    ${k}`)));
    }
    return;
  }

  // Archive the new build's chunks FIRST. The cache upload below overwrites the
  // live cache in place (pinned BUILD_ID), so the still-live previous deploy
  // starts serving the new pages ~10 minutes before `wrangler deploy` publishes
  // the chunks they reference. Until then only this archive can serve them.
  if (upload) await syncStaticArchive(client);
  // Before the pages that read it, for the same reason.
  if (upload) await syncTitles(client);

  // Uploads
  const UPLOAD_RETRIES = 3;
  let uploaded = 0;
  let failed = 0;
  await pool(toUpload, CONCURRENCY, async (a) => {
    const { body, srchash } = bodyFor(a); // must match the diff above, or every deploy re-uploads
    for (let attempt = 1; attempt <= UPLOAD_RETRIES; attempt++) {
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: BUCKET,
            Key: a.key,
            Body: body,
            ContentEncoding: "gzip",
            ContentType: "application/json",
            Metadata: { srchash },
          }),
        );
        if (++uploaded % 1000 === 0) console.log(c.dim(`    uploaded ${uploaded}/${toUpload.length}`));
        return;
      } catch (e) {
        // Under CONCURRENCY parallel uploads, large bodies are the most likely
        // to hit a transient socket/timeout error — retry before giving up.
        if (attempt === UPLOAD_RETRIES) {
          failed++;
          console.error(c.red(`    upload failed ${a.key} (${body.length}B): ${e instanceof Error ? e.message : e}`));
        } else {
          await new Promise((r) => setTimeout(r, 500 * attempt));
        }
      }
    }
  });
  console.log(`  uploaded ${uploaded}/${toUpload.length}${failed ? c.red(` (${failed} failed)`) : ""}`);

  // Deletes (DeleteObjects handles up to 1000 keys per request). Batched in
  // parallel, because one round trip costs the same whatever it carries, and a
  // sequential loop spent over an hour on a full prune. Concurrency is lower
  // than the uploads' and every batch retries: R2 answers a burst of deletes
  // with "Reduce your concurrent request rate", and an unretried throw here
  // kills the deploy before wrangler runs.
  const DELETE_CONCURRENCY = 6;
  const DELETE_RETRIES = 6;
  const batches: string[][] = [];
  for (let i = 0; i < toDelete.length; i += 1000) batches.push(toDelete.slice(i, i + 1000));
  let deleted = 0;
  let deleteFailed = 0;
  await pool(batches, DELETE_CONCURRENCY, async (batch) => {
    for (let attempt = 1; attempt <= DELETE_RETRIES; attempt++) {
      try {
        await client.send(
          new DeleteObjectsCommand({
            Bucket: BUCKET,
            Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
          }),
        );
        deleted += batch.length;
        console.log(c.dim(`    deleted ${deleted}/${toDelete.length}`));
        return;
      } catch (e) {
        if (attempt === DELETE_RETRIES) {
          deleteFailed += batch.length;
          console.error(c.red(`    delete failed for ${batch.length} key(s): ${e instanceof Error ? e.message : e}`));
        } else {
          await new Promise((r) => setTimeout(r, 400 * 2 ** (attempt - 1)));
        }
      }
    }
  });
  // An orphan left behind costs storage, not correctness. Never fail the deploy
  // for it: wrangler has not run yet at this point.
  if (deleteFailed) console.log(c.yellow(`  ${deleteFailed} orphan(s) left for the next run`));

  console.log("");
  console.log(c.bold(`Done. ${uploaded} uploaded, ${deleted} deleted.`));
  if (failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error(c.red(e instanceof Error ? e.stack ?? e.message : String(e)));
  process.exit(1);
});

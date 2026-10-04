# Testing

Test your change. Do not commit the test.

Write the smallest check that fails if the logic breaks, run it, read the
result, then delete it. A test written for one change is waste in the tree: it
adds files to read, it goes stale, and nobody runs it again. Keep a test only
if the user asks for it.

Scratch scripts, smoke tests, and one-off harnesses go in a temporary
directory, never in the repo.

## Local production test

Test a production build on your machine before you push. A local test is
free. A prod test costs a live deploy, and a bad deploy costs live traffic.

Use this order:

1. Build and run `next build` then `next start`. This is plain Node, no
   Cloudflare code at all. It finds bugs in your own code first.
2. Build and run `bun run preview`. This runs the real Worker code
   (`opennextjs-cloudflare`) inside workerd, the same runtime as production.
   Use this step to find bugs that are specific to the Cloudflare adapter.
   It does not run on Windows: the bundle OpenNext writes there holds Windows
   path separators, so workerd cannot resolve the wasm imports or the Turbopack
   chunks. Use WSL, or accept step 1 alone.
3. Only push to `web-prod` once both pass. CI deploys on that push — see
   [Deployment](deployment.md).

Every doc address gets one notice, filled in by the Worker from the title map
(`lib/notice.ts`). The local preview starts with an empty cache bucket, so it
has neither the notice nor the map. To test a doc page as production serves
it, put the `/docs-notice` entry from `.open-next/cache` and the title map into
the local bucket, in the format `scripts/cache-sync.ts` writes.

Send a real browser user agent, `Accept` and `Accept-Language` headers, or the
site treats you as an agent and answers in plain text:

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36" \
  -H "Accept: text/html" -H "Accept-Language: en-US,en;q=0.9" \
  "http://localhost:3000/docs/houdini/nodes/sop/box"
```

After you deploy, confirm the change on live traffic:

1. `wrangler tail houdinimd --format pretty` to watch live requests and
   errors in real time.
2. Query the `views` table in the `houdinimd-analytics` D1 database for
   paths that failed:
   ```bash
   wrangler d1 execute houdinimd-analytics --remote --command \
     "SELECT path, COUNT(*) AS n FROM views WHERE status = 500 GROUP BY path ORDER BY n DESC LIMIT 20;"
   ```
3. Re-check each of those paths with the same browser-header `curl` above.
4. Load one page in the browser and look at it. A status is not proof the
   page reads — see [Front-end](frontend.md).

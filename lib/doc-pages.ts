/**
 * The doc addresses the site served, and each page's title: all the takedown
 * notice keeps of a page. Read at deploy by scripts/cache-sync.ts from the
 * index in R2, which is not in this repo and is not public.
 */
let pages: Promise<Map<string, string>> | undefined;

/** The trees the site served. The index also holds old versions of them, and
    doxygen's header listings, which the site had stopped serving. */
const SERVED = /^(houdini|hengine|api)(\/|$)/;
const served = (path: string) => SERVED.test(path) && !path.endsWith("_source");

export const docPages = () => (pages ??= load());

async function load(): Promise<Map<string, string>> {
  const entries: { path: string; title: string }[] = JSON.parse(await readIndex());
  return new Map(entries.filter((e) => served(e.path)).map((e) => [e.path, e.title]));
}

/** Over the S3 API. Imported here, not at the top, so the Worker never loads the SDK. */
async function readIndex(): Promise<string> {
  const { CF_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME } = process.env;
  // Every doc notice would lose its title, so the build stops.
  if (!CF_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) {
    throw new Error("The R2 keys are not set: the doc notices need the titles in content/index.json.");
  }
  const { S3Client, GetObjectCommand } = await import("@aws-sdk/client-s3");
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${CF_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  });
  const object = await client.send(new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: "content/index.json" }));
  return object.Body!.transformToString("utf-8");
}

import {readFile} from 'node:fs/promises';
import {GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client} from '@aws-sdk/client-s3';
import {parseCatalog} from '../../src/catalog/catalog-types.ts';
import {mirrorCatalog, type ObjectStore} from './mirror.ts';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`Missing environment variable ${name}`);
  return value;
}

function r2Store(): ObjectStore {
  const bucket = requireEnv('R2_BUCKET');
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${requireEnv('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY'),
    },
  });
  return {
    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          CacheControl: 'public, max-age=300',
        }),
      );
    },
    async getText(key) {
      try {
        const object = await client.send(new GetObjectCommand({Bucket: bucket, Key: key}));
        return (await object.Body?.transformToString()) ?? null;
      } catch (error) {
        if (error instanceof NoSuchKey) return null;
        throw error;
      }
    },
  };
}

const catalogPath = new URL('../../catalog/catalog.json', import.meta.url);
const catalog = parseCatalog(JSON.parse(await readFile(catalogPath, 'utf8')));
const report = await mirrorCatalog(catalog, {
  fetch: (url) => fetch(url),
  store: r2Store(),
  now: () => new Date(),
  log: (message) => console.log(message),
});
if (report.failures.length > 0) {
  console.error(`Failed to mirror: ${report.failures.join(', ')}`);
  process.exitCode = 1;
}

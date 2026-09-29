import { createHash, createHmac } from 'crypto';

/**
 * AWS Signature Version 4, query-string presigning for S3 (T8.2). Written
 * here rather than pulled in as an SDK: the server needs exactly one thing
 * from S3, a presigned PUT or GET (and HEAD/DELETE for housekeeping) with an
 * unsigned payload, and the algorithm is a short, well-specified HMAC
 * chain. Verified against the worked example in the S3 documentation
 * ("Authenticating Requests: Using Query Parameters").
 */
export type PresignParams = {
  method: 'GET' | 'PUT' | 'HEAD' | 'DELETE';
  endpoint: string; // e.g. https://s3.amazonaws.com or https://minio.local:9000
  bucket: string;
  key: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  expiresSeconds: number;
  /** path-style (endpoint/bucket/key) for MinIO, R2 and friends; virtual-hosted (bucket.endpoint/key) for AWS. */
  pathStyle: boolean;
  now?: Date;
};

const encode = (s: string): string => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const sha256Hex = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');
const hmac = (key: Buffer | string, data: string): Buffer => createHmac('sha256', key).update(data, 'utf8').digest();

function amzDate(d: Date): { amz: string; date: string } {
  const iso = d.toISOString().replace(/[:-]|\.\d{3}/g, ''); // 20130524T000000Z
  return { amz: iso, date: iso.slice(0, 8) };
}

export function presignS3(p: PresignParams): { url: string; host: string; signature: string; canonicalRequest: string } {
  const endpoint = new URL(p.endpoint);
  const host = p.pathStyle ? endpoint.host : `${p.bucket}.${endpoint.host}`;
  const basePath = endpoint.pathname.replace(/\/+$/, '');
  const objectPath = (p.pathStyle ? `/${p.bucket}` : '') + '/' + p.key.split('/').map(encode).join('/');
  const canonicalUri = basePath + objectPath;
  const { amz, date } = amzDate(p.now ?? new Date());
  const scope = `${date}/${p.region}/s3/aws4_request`;
  const query: Array<[string, string]> = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${p.accessKeyId}/${scope}`],
    ['X-Amz-Date', amz],
    ['X-Amz-Expires', String(p.expiresSeconds)],
    ['X-Amz-SignedHeaders', 'host'],
  ];
  const canonicalQuery = query
    .map(([k, v]) => [encode(k), encode(v)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const canonicalRequest = [p.method, canonicalUri, canonicalQuery, `host:${host}`, '', 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amz, scope, sha256Hex(canonicalRequest)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac('AWS4' + p.secretAccessKey, date), p.region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');
  const url = `${endpoint.protocol}//${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
  return { url, host, signature, canonicalRequest };
}

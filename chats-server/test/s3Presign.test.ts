import { describe, expect, it } from 'vitest';
import { presignS3 } from '../src/lib/s3Presign';

/**
 * T8.2 — SigV4 query presigning, checked against the worked example in the
 * S3 documentation ("Authenticating Requests: Using Query Parameters (AWS
 * Signature Version 4)", example: presigned GET of test.txt).
 */
describe('T8.2 S3 presigning', () => {
  it('reproduces the documented example signature for a virtual-hosted GET', () => {
    const r = presignS3({
      method: 'GET',
      endpoint: 'https://s3.amazonaws.com',
      bucket: 'examplebucket',
      key: 'test.txt',
      region: 'us-east-1',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      expiresSeconds: 86_400,
      pathStyle: false,
      now: new Date(Date.UTC(2013, 4, 24, 0, 0, 0)),
    });
    expect(r.host).toBe('examplebucket.s3.amazonaws.com');
    expect(r.canonicalRequest).toBe(
      [
        'GET',
        '/test.txt',
        'X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host',
        'host:examplebucket.s3.amazonaws.com',
        '',
        'host',
        'UNSIGNED-PAYLOAD',
      ].join('\n'),
    );
    expect(r.signature).toBe('aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404');
    expect(r.url).toBe(
      'https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
    );
  });

  it('path-style keeps the endpoint host and puts the bucket in the path; keys are segment-encoded', () => {
    const r = presignS3({
      method: 'PUT',
      endpoint: 'https://minio.example.internal:9000/prefix',
      bucket: 'velo',
      key: 'ab cd/ef+gh',
      region: 'eu-central-1',
      accessKeyId: 'AK',
      secretAccessKey: 'SK',
      expiresSeconds: 900,
      pathStyle: true,
      now: new Date(Date.UTC(2026, 8, 29, 12, 0, 0)),
    });
    expect(r.host).toBe('minio.example.internal:9000');
    expect(r.url.startsWith('https://minio.example.internal:9000/prefix/velo/ab%20cd/ef%2Bgh?X-Amz-Algorithm=AWS4-HMAC-SHA256')).toBe(true);
    expect(r.canonicalRequest.split('\n')[0]).toBe('PUT');
    expect(r.canonicalRequest.split('\n')[1]).toBe('/prefix/velo/ab%20cd/ef%2Bgh');
    expect(r.signature).toMatch(/^[0-9a-f]{64}$/);
  });
});

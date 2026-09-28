import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * T4.10 — certificate pinning is declared in the Android network security
 * config. This pins the shape so a release cannot ship without pins, with a
 * single pin (no rotation path), with cleartext, or with an expiration so
 * far away that a forgotten pin-set becomes a brick.
 */
const android = join(__dirname, '..', '..', '..', '..', 'android', 'app', 'src');
const release = readFileSync(join(android, 'main', 'res', 'xml', 'network_security_config.xml'), 'utf8');
const debug = readFileSync(join(android, 'debug', 'res', 'xml', 'network_security_config.xml'), 'utf8');
const envExample = readFileSync(join(__dirname, '..', '..', '..', '..', '.env.example'), 'utf8');

const pins = (xml: string) => Array.from(xml.matchAll(/<pin digest="SHA-256">([^<]+)<\/pin>/g), (m) => m[1]!);

describe('T4.10 Android network security config', () => {
  it('release: no cleartext, system trust only, and the API host pinned with two SPKI pins', () => {
    expect(release).toMatch(/<base-config cleartextTrafficPermitted="false">/);
    expect(release).not.toMatch(/certificates src="user"/);
    expect(release).toMatch(/<domain-config cleartextTrafficPermitted="false">/);
    const p = pins(release);
    expect(p.length).toBeGreaterThanOrEqual(2); // a current pin and a backup pin
    for (const pin of p) expect(pin).toMatch(/^[A-Za-z0-9+/]{43}=$/); // base64 of 32 bytes
    expect(new Set(p).size).toBe(p.length);
  });

  it('release: the pinned domain is the API host from .env.example', () => {
    const host = /API_URL=https:\/\/([^/\s]+)/.exec(envExample)?.[1];
    expect(host).toBeTruthy();
    expect(release).toContain(`<domain includeSubdomains="false">${host}</domain>`);
  });

  it('release: the pin-set expires between three months and two years from now (fail-open safety net, kept current)', () => {
    const exp = /<pin-set expiration="(\d{4}-\d{2}-\d{2})">/.exec(release)?.[1];
    expect(exp).toBeTruthy();
    const ms = Date.parse(exp!) - Date.now();
    const day = 24 * 3600 * 1000;
    expect(ms).toBeGreaterThan(90 * day);
    expect(ms).toBeLessThan(2 * 365 * day + day);
  });

  it('debug: no pins, cleartext only to local development hosts', () => {
    expect(pins(debug)).toEqual([]);
    expect(debug).toMatch(/<base-config cleartextTrafficPermitted="false">/);
    const cleartextDomains = Array.from(debug.matchAll(/<domain includeSubdomains="false">([^<]+)<\/domain>/g), (m) => m[1]!);
    for (const d of cleartextDomains) expect(d).toMatch(/^(localhost|127\.0\.0\.1|10\.0\.2\.2|\d{1,3}(\.\d{1,3}){3})$/);
  });
});

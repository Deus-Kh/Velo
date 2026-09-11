import { requireUrl } from '../requireUrl';

describe('requireUrl', () => {
  it('throws when the value is missing or blank', () => {
    expect(() => requireUrl('API_URL', undefined, true)).toThrow(/Missing env var API_URL/);
    expect(() => requireUrl('API_URL', '   ', true)).toThrow(/Missing env var API_URL/);
  });

  it('rejects non-http schemes', () => {
    expect(() => requireUrl('API_URL', 'ftp://example.com', true)).toThrow(/must start with http/);
    expect(() => requireUrl('API_URL', 'example.com', true)).toThrow(/must start with http/);
  });

  it('strips trailing slashes', () => {
    expect(requireUrl('API_URL', 'https://api.example.com///', true)).toBe('https://api.example.com');
  });

  it('allows cleartext only in development builds', () => {
    expect(requireUrl('API_URL', 'http://10.0.2.2:9999', true)).toBe('http://10.0.2.2:9999');
    expect(() => requireUrl('API_URL', 'http://10.0.2.2:9999', false)).toThrow(
      /must use https:\/\/ in release builds/,
    );
  });

  it('accepts https in release builds', () => {
    expect(requireUrl('SOCKET_URL', 'https://api.example.com', false)).toBe('https://api.example.com');
  });
});

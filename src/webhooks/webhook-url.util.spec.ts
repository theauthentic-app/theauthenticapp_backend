import { isPrivateIp } from './webhook-url.util';

describe('isPrivateIp', () => {
  it('blocks loopback, RFC1918, and link-local addresses', () => {
    expect(isPrivateIp('127.0.0.1')).toBe(true);
    expect(isPrivateIp('10.0.0.8')).toBe(true);
    expect(isPrivateIp('192.168.1.10')).toBe(true);
    expect(isPrivateIp('172.16.0.2')).toBe(true);
    expect(isPrivateIp('169.254.1.1')).toBe(true);
    expect(isPrivateIp('8.8.8.8')).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
// Next 16.2 exporte encore l'utilitaire sous son ancien nom (unstable_doesProxyMatch dans la doc).
import { unstable_doesMiddlewareMatch as doesProxyMatch } from 'next/experimental/testing/server';
import { isLocalHost } from '@/lib/api';
import { proxy, config } from '@/proxy';

describe('isLocalHost', () => {
  it.each(['127.0.0.1', '127.0.0.1:3000', 'localhost', 'localhost:3100', 'LOCALHOST:3000', '[::1]', '[::1]:3000'])(
    'accepts %s',
    (host) => expect(isLocalHost(host)).toBe(true),
  );

  it.each([
    null,
    '',
    'evil.example',
    'evil.example:3000',
    '127.0.0.1.evil.example',
    'localhost.evil.example:3000',
    'evil@127.0.0.1',
    '127.0.0.1/evil',
    '127.0.0.1 evil',
    '10.0.0.5:3000',
  ])('rejects %s', (host) => expect(isLocalHost(host)).toBe(false));
});

describe('proxy', () => {
  const request = (host: string) => new NextRequest('http://127.0.0.1:3000/api/projects/svc/settings', { headers: { host } });

  it('runs on API routes only', () => {
    expect(doesProxyMatch({ config, url: '/api/projects/svc/settings' })).toBe(true);
    expect(doesProxyMatch({ config, url: '/api/sse' })).toBe(true);
    expect(doesProxyMatch({ config, url: '/' })).toBe(false);
  });

  it('refuses a rebound host with 403', async () => {
    const res = proxy(request('attacker.example:3000'));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Hôte non autorisé' });
  });

  it('lets a local host through', () => {
    const res = proxy(request('127.0.0.1:3000'));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });
});

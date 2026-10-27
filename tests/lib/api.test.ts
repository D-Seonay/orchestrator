import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { guardMutation, readJson } from '@/lib/api';
import { POST as postAction } from '@/app/api/projects/action/route';
import { PUT as putGroup, DELETE as deleteGroup } from '@/app/api/groups/route';
import { PUT as putSettings } from '@/app/api/settings/route';
import { POST as postSwitch } from '@/app/api/branches/switch/route';

const URL_ = 'http://127.0.0.1:3000/api/x';
const req = (headers: Record<string, string>, body?: string, method = 'POST') =>
  new NextRequest(URL_, { method, headers, body });

describe('readJson', () => {
  it('accepts application/json (with charset)', async () => {
    expect(await readJson(req({ 'content-type': 'application/json; charset=utf-8' }, '{"a":1}'))).toEqual({ a: 1 });
  });

  it('rejects text/plain and missing content-type even with a valid JSON body', async () => {
    expect(await readJson(req({ 'content-type': 'text/plain' }, '{"a":1}'))).toBeNull();
    expect(await readJson(req({}, '{"a":1}'))).toBeNull();
  });
});

describe('guardMutation', () => {
  it('rejects a foreign Origin with 403', async () => {
    const res = guardMutation(req({ origin: 'https://evil.example' }));
    expect(res?.status).toBe(403);
  });

  it('rejects an unparsable Origin (e.g. "null")', () => {
    expect(guardMutation(req({ origin: 'null' }))?.status).toBe(403);
  });

  it('rejects a look-alike host', () => {
    expect(guardMutation(req({ origin: 'http://127.0.0.1.evil.example' }))?.status).toBe(403);
  });

  it.each(['http://127.0.0.1:3000', 'http://localhost:3100', 'http://127.0.0.1'])('accepts %s', (origin) => {
    expect(guardMutation(req({ origin }))).toBeNull();
  });

  it('accepts requests without Origin (local tooling)', () => {
    expect(guardMutation(req({}))).toBeNull();
  });
});

describe('mutating routes', () => {
  const json = { 'content-type': 'application/json' };

  it('text/plain body → 400', async () => {
    const res = await postAction(req({ 'content-type': 'text/plain' }, '{"names":[],"action":"start"}'));
    expect(res.status).toBe(400);
  });

  it('foreign Origin → 403 on every mutating handler, before any side effect', async () => {
    const evil = { ...json, origin: 'https://evil.example' };
    const calls = [
      postAction(req(evil, '{"names":["x"],"action":"stop"}')),
      postSwitch(req(evil, '{"names":["x"],"branch":"main"}')),
      putGroup(req(evil, '{"name":"g","members":[]}', 'PUT')),
      deleteGroup(new NextRequest(`${URL_}?name=g`, { method: 'DELETE', headers: { origin: 'https://evil.example' } })),
      putSettings(req(evil, '{"root":"C:\\\\"}', 'PUT')),
    ];
    for (const res of await Promise.all(calls)) expect(res.status).toBe(403);
  });

  it('local Origin with JSON is accepted', async () => {
    const res = await postAction(req({ ...json, origin: 'http://127.0.0.1:3000' }, '{"names":[],"action":"start"}'));
    expect(res.status).toBe(200);
  });
});

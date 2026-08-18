import { describe, it, expect } from 'vitest';
import { isRequestAllowed } from '../lib/origin-guard.mjs';

const post = (origin, host = '127.0.0.1:4177') =>
  isRequestAllowed({ method: 'POST', origin, host });

describe('origin guard', () => {
  it('refuses a POST a foreign page made on the user behalf', () => {
    // The attack: any open tab can start a skill run, which is a headless
    // Claude Code invocation with acceptEdits on the vault.
    expect(post('https://evil.example')).toBe(false);
  });

  it('allows a POST from the app itself', () => {
    expect(post('http://127.0.0.1:4177')).toBe(true);
  });

  it('allows the dev server, whose proxy rewrites Host but not Origin', () => {
    // vite proxies /api with changeOrigin, so the ports never match.
    expect(post('http://localhost:4173', 'localhost:4177')).toBe(true);
  });

  it('allows the Tailscale hostname when it addresses itself', () => {
    expect(post('https://ravi-zorin.tailnet.ts.net', 'ravi-zorin.tailnet.ts.net')).toBe(true);
  });

  it('refuses a foreign origin even when the host is a Tailscale name', () => {
    expect(post('https://evil.example', 'ravi-zorin.tailnet.ts.net')).toBe(false);
  });

  it('refuses a loopback origin when the request was addressed elsewhere', () => {
    // Otherwise "origin is loopback" alone would wave through a request aimed
    // at the Tailscale hostname.
    expect(post('http://localhost:4173', 'ravi-zorin.tailnet.ts.net')).toBe(false);
  });

  it('allows clients that send no Origin at all', () => {
    // curl, health checks, the scheduler.
    expect(post(undefined)).toBe(true);
  });

  it('refuses an Origin that does not parse', () => {
    expect(post('not a url')).toBe(false);
  });

  it('never blocks reads', () => {
    expect(isRequestAllowed({ method: 'GET', origin: 'https://evil.example', host: 'x' })).toBe(true);
  });
});

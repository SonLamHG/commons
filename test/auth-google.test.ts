import { describe, it, expect } from 'vitest';
import { createGoogleOAuth } from '../src/auth/google.js';

const cfg = {
  clientId: 'cid.apps.googleusercontent.com',
  clientSecret: 'secret',
  redirectUri: 'http://localhost:8787/api/auth/google/callback',
};

describe('createGoogleOAuth.authUrl', () => {
  it('builds a Google consent URL with required params', () => {
    const url = new URL(createGoogleOAuth(cfg).authUrl('state-123'));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe(cfg.clientId);
    expect(url.searchParams.get('redirect_uri')).toBe(cfg.redirectUri);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('openid email');
    expect(url.searchParams.get('state')).toBe('state-123');
  });
});

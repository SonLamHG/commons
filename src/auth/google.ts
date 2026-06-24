export interface GoogleProfile { email: string; emailVerified: boolean; }

export interface GoogleOAuth {
  /** URL để redirect user tới Google. */
  authUrl(state: string): string;
  /** Đổi authorization code -> hồ sơ; null nếu thất bại/không có email. */
  exchangeCode(code: string): Promise<GoogleProfile | null>;
}

interface Cfg { clientId: string; clientSecret: string; redirectUri: string; }

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/** Decode the payload segment of a JWT (no signature check — token came
 *  straight from Google over HTTPS in this request). */
function decodeIdToken(idToken: string): { email?: string; email_verified?: boolean } | null {
  const seg = idToken.split('.')[1];
  if (!seg) return null;
  try { return JSON.parse(Buffer.from(seg, 'base64url').toString('utf8')); }
  catch { return null; }
}

export function createGoogleOAuth(cfg: Cfg): GoogleOAuth {
  return {
    authUrl(state) {
      const u = new URL(AUTH_ENDPOINT);
      u.search = new URLSearchParams({
        client_id: cfg.clientId,
        redirect_uri: cfg.redirectUri,
        response_type: 'code',
        scope: 'openid email',
        state,
        access_type: 'online',
        prompt: 'select_account',
      }).toString();
      return u.toString();
    },
    async exchangeCode(code) {
      const r = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
          redirect_uri: cfg.redirectUri,
          grant_type: 'authorization_code',
        }).toString(),
      });
      if (!r.ok) return null;
      const tok = (await r.json()) as { id_token?: string };
      if (!tok.id_token) return null;
      const claims = decodeIdToken(tok.id_token);
      if (!claims || typeof claims.email !== 'string') return null;
      return { email: claims.email.toLowerCase(), emailVerified: claims.email_verified === true };
    },
  };
}

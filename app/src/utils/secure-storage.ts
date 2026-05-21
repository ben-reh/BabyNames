import * as SecureStore from 'expo-secure-store';

const KEYS = {
  ID_TOKEN:      'cognito_id_token',
  ACCESS_TOKEN:  'cognito_access_token',
  REFRESH_TOKEN: 'cognito_refresh_token',
  SUB:           'cognito_sub',
  EMAIL:         'cognito_email',
} as const;

export const tokenStorage = {
  async save(tokens: { idToken: string; accessToken: string; refreshToken: string; sub: string; email: string }) {
    await Promise.all([
      SecureStore.setItemAsync(KEYS.ID_TOKEN,      tokens.idToken),
      SecureStore.setItemAsync(KEYS.ACCESS_TOKEN,  tokens.accessToken),
      SecureStore.setItemAsync(KEYS.REFRESH_TOKEN, tokens.refreshToken),
      SecureStore.setItemAsync(KEYS.SUB,           tokens.sub),
      SecureStore.setItemAsync(KEYS.EMAIL,         tokens.email),
    ]);
  },

  async load(): Promise<{ idToken: string; accessToken: string; refreshToken: string; sub: string; email: string } | null> {
    const [idToken, accessToken, refreshToken, sub, email] = await Promise.all([
      SecureStore.getItemAsync(KEYS.ID_TOKEN),
      SecureStore.getItemAsync(KEYS.ACCESS_TOKEN),
      SecureStore.getItemAsync(KEYS.REFRESH_TOKEN),
      SecureStore.getItemAsync(KEYS.SUB),
      SecureStore.getItemAsync(KEYS.EMAIL),
    ]);
    if (!idToken || !sub) return null;
    return { idToken: idToken!, accessToken: accessToken!, refreshToken: refreshToken!, sub: sub!, email: email! };
  },

  async clear() {
    await Promise.all(Object.values(KEYS).map(k => SecureStore.deleteItemAsync(k)));
  },
};

export function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return {};
  }
}

export function isTokenExpired(idToken: string): boolean {
  const { exp } = decodeJwtPayload(idToken) as { exp?: number };
  if (!exp) return true;
  return Date.now() / 1000 > exp - 60;
}

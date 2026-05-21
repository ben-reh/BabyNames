import { useEffect, useRef } from 'react';
import { CognitoUser, CognitoUserPool, AuthenticationDetails, CognitoUserAttribute } from 'amazon-cognito-identity-js';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { useAuthStore, useSessionStore } from '../store';
import { tokenStorage, isTokenExpired, decodeJwtPayload } from '../utils/secure-storage';
import { AUTH } from '../constants/auth';
import { api } from '../api/client';

WebBrowser.maybeCompleteAuthSession();

const userPool = new CognitoUserPool({
  UserPoolId: AUTH.USER_POOL_ID,
  ClientId:   AUTH.CLIENT_ID,
});

const discovery: AuthSession.DiscoveryDocument = {
  authorizationEndpoint: `${AUTH.DOMAIN}/oauth2/authorize`,
  tokenEndpoint:         `${AUTH.DOMAIN}/oauth2/token`,
  revocationEndpoint:    `${AUTH.DOMAIN}/oauth2/revoke`,
};

async function runMigrationIfNeeded(sub: string, deviceId: string | null, migrationDone: boolean) {
  if (migrationDone || !deviceId || deviceId === sub) return;
  try {
    await api.post('/auth/migrate', { deviceId, cognitoSub: sub });
    useAuthStore.getState().setMigrationDone();
  } catch {
    // best-effort — don't block sign-in on failure
  }
}

export function useAuth() {
  const { sub, email, migrationDone, setAuth, clearAuth } = useAuthStore();
  const { deviceId } = useSessionStore();
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    (async () => {
      const stored = await tokenStorage.load();
      if (!stored) return;
      if (isTokenExpired(stored.idToken)) { await tokenStorage.clear(); return; }
      setAuth(stored.sub, stored.email);
    })();
  }, [setAuth]);

  async function signInEmail(emailInput: string, password: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const cognitoUser = new CognitoUser({ Username: emailInput, Pool: userPool });
      const authDetails  = new AuthenticationDetails({ Username: emailInput, Password: password });
      cognitoUser.authenticateUser(authDetails, {
        onSuccess: async (session) => {
          const idToken     = session.getIdToken().getJwtToken();
          const accessToken = session.getAccessToken().getJwtToken();
          const refreshToken = session.getRefreshToken().getToken();
          const payload = decodeJwtPayload(idToken) as { sub: string; email: string };
          await tokenStorage.save({ idToken, accessToken, refreshToken, sub: payload.sub, email: payload.email });
          setAuth(payload.sub, payload.email);
          await runMigrationIfNeeded(payload.sub, deviceId, migrationDone);
          resolve();
        },
        onFailure: (err) => reject(err),
        newPasswordRequired: () => reject(new Error('NEW_PASSWORD_REQUIRED')),
      });
    });
  }

  async function signUpEmail(emailInput: string, password: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const attrs = [new CognitoUserAttribute({ Name: 'email', Value: emailInput })];
      userPool.signUp(emailInput, password, attrs, [], (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  async function confirmSignUp(emailInput: string, code: string): Promise<void> {
    return new Promise((resolve, reject) => {
      new CognitoUser({ Username: emailInput, Pool: userPool })
        .confirmRegistration(code, true, (err) => { if (err) return reject(err); resolve(); });
    });
  }

  async function resendConfirmationCode(emailInput: string): Promise<void> {
    return new Promise((resolve, reject) => {
      new CognitoUser({ Username: emailInput, Pool: userPool })
        .resendConfirmationCode((err) => { if (err) return reject(err); resolve(); });
    });
  }

  async function forgotPassword(emailInput: string): Promise<void> {
    return new Promise((resolve, reject) => {
      new CognitoUser({ Username: emailInput, Pool: userPool })
        .forgotPassword({ onSuccess: () => resolve(), onFailure: (err) => reject(err) });
    });
  }

  async function confirmForgotPassword(emailInput: string, code: string, newPassword: string): Promise<void> {
    return new Promise((resolve, reject) => {
      new CognitoUser({ Username: emailInput, Pool: userPool })
        .confirmPassword(code, newPassword, { onSuccess: () => resolve(), onFailure: (err) => reject(err) });
    });
  }

  function useSocialSignIn(provider: 'Apple' | 'Google') {
    const redirectUri = AuthSession.makeRedirectUri({ scheme: 'babynames', path: 'auth/callback' });
    const [request, response, promptAsync] = AuthSession.useAuthRequest(
      { clientId: AUTH.CLIENT_ID, scopes: ['openid', 'email', 'profile'], redirectUri, extraParams: { identity_provider: provider } },
      discovery,
    );

    useEffect(() => {
      if (response?.type !== 'success') return;
      const { code } = response.params;
      (async () => {
        const tokenResult = await AuthSession.exchangeCodeAsync(
          { clientId: AUTH.CLIENT_ID, code, redirectUri, extraParams: { code_verifier: request!.codeVerifier! } },
          discovery,
        );
        const idToken      = tokenResult.idToken ?? '';
        const accessToken  = tokenResult.accessToken;
        const refreshToken = tokenResult.refreshToken ?? '';
        const payload = decodeJwtPayload(idToken) as { sub: string; email: string };
        await tokenStorage.save({ idToken, accessToken, refreshToken, sub: payload.sub, email: payload.email });
        setAuth(payload.sub, payload.email);
        await runMigrationIfNeeded(payload.sub, deviceId, migrationDone);
      })();
    }, [response]); // eslint-disable-line react-hooks/exhaustive-deps

    return { request, promptAsync };
  }

  async function signOut() {
    await tokenStorage.clear();
    clearAuth();
  }

  return {
    sub, email,
    isAuthenticated: !!sub,
    signInEmail, signUpEmail, confirmSignUp, resendConfirmationCode,
    forgotPassword, confirmForgotPassword,
    useSocialSignIn, signOut,
  };
}

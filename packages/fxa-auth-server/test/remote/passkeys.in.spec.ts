/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  createTestServer,
  TestServerInstance,
} from '../support/helpers/test-server';

const Client = require('../client')();
const { default: Container } = require('typedi');
const {
  PlaySubscriptions,
} = require('../../lib/payments/iap/google-play/subscriptions');
const {
  AppStoreSubscriptions,
} = require('../../lib/payments/iap/apple-app-store/subscriptions');
const { PasskeyService } = require('@fxa/accounts/passkey');

let server: TestServerInstance;

const mockRegistrationOptions = {
  challenge: 'challenge-abc',
  rp: { name: 'Firefox Accounts', id: 'accounts.firefox.com' },
  user: { id: 'uid', name: 'test@example.com', displayName: 'test@example.com' },
  pubKeyCredParams: [],
  timeout: 60000,
  attestation: 'none',
};

const mockPasskey = {
  credentialId: 'credential-id-xyz',
  name: 'My Passkey',
  createdAt: Date.now(),
  lastUsedAt: Date.now(),
  transports: ['internal'],
};

const mockPasskeyService = {
  generateRegistrationChallenge: jest.fn().mockResolvedValue(mockRegistrationOptions),
  verifyRegistrationResponse: jest.fn().mockResolvedValue(mockPasskey),
};

beforeAll(async () => {
  Container.set(PlaySubscriptions, {});
  Container.set(AppStoreSubscriptions, {});
  // Pre-register mock PasskeyService since real methods are not yet implemented (FXA-13069)
  Container.set(PasskeyService, mockPasskeyService);

  server = await createTestServer({
    configOverrides: {
      securityHistory: { ipProfiling: {} },
      signinConfirmation: { skipForNewAccounts: { enabled: false } },
      mfa: {
        enabled: true,
        actions: ['passkey'],
      },
      passkeys: {
        enabled: true,
      },
    },
  });
}, 120000);

afterAll(async () => {
  await server.stop();
});

beforeEach(() => {
  jest.clearAllMocks();
});

const password = 'pssssst';
const metricsContext = {
  flowBeginTime: Date.now(),
  flowId: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
};

describe('#integration - remote passkey registration', () => {
  let passkeyEmail: string;
  let passkeyClient: any;

  beforeEach(async () => {
    passkeyEmail = server.uniqueEmail();
    passkeyClient = await Client.createAndVerify(
      server.publicUrl,
      passkeyEmail,
      password,
      server.mailbox
    );
  });

  async function getMfaAccessTokenForPasskey(clientInstance: any) {
    // Request an OTP for MFA action 'passkey'
    await clientInstance.api.doRequest(
      'POST',
      `${clientInstance.api.baseURL}/mfa/otp/request`,
      await clientInstance.api.Token.SessionToken.fromHex(
        clientInstance.sessionToken
      ),
      { action: 'passkey' }
    );

    // Read OTP code from mailbox
    const code = await server.mailbox.waitForMfaCode(clientInstance.email);

    // Verify OTP and get back a JWT access token
    const verifyRes = await clientInstance.api.doRequest(
      'POST',
      `${clientInstance.api.baseURL}/mfa/otp/verify`,
      await clientInstance.api.Token.SessionToken.fromHex(
        clientInstance.sessionToken
      ),
      { action: 'passkey', code }
    );
    return verifyRes.accessToken;
  }

  it('POST /passkey/registration/start - with valid MFA JWT returns registration options', async () => {
    const accessToken = await getMfaAccessTokenForPasskey(passkeyClient);

    const result = await passkeyClient.api.doRequestWithBearerToken(
      'POST',
      `${passkeyClient.api.baseURL}/passkey/registration/start`,
      accessToken,
      {}
    );

    expect(result).toBeDefined();
    expect(result.challenge).toBeTruthy();
    expect(mockPasskeyService.generateRegistrationChallenge).toHaveBeenCalledTimes(1);
  });

  it('POST /passkey/registration/start - without auth returns 401', async () => {
    let error: any;
    try {
      await passkeyClient.api.doRequestWithBearerToken(
        'POST',
        `${passkeyClient.api.baseURL}/passkey/registration/start`,
        'invalid-token',
        {}
      );
    } catch (err) {
      error = err;
    }

    expect(error).toBeDefined();
    expect(error.code).toBe(401);
  });

  it('POST /passkey/registration/finish - with valid payload returns passkey', async () => {
    const accessToken = await getMfaAccessTokenForPasskey(passkeyClient);

    const result = await passkeyClient.api.doRequestWithBearerToken(
      'POST',
      `${passkeyClient.api.baseURL}/passkey/registration/finish`,
      accessToken,
      {
        response: { id: 'cred', response: { attestationObject: 'abc' } },
        challenge: 'challenge-abc',
      }
    );

    expect(result.credentialId).toBe(mockPasskey.credentialId);
    expect(result.name).toBe(mockPasskey.name);
    expect(result.transports).toEqual(mockPasskey.transports);
    expect(mockPasskeyService.verifyRegistrationResponse).toHaveBeenCalledTimes(1);
  });

  it('POST /passkey/registration/finish - without auth returns 401', async () => {
    let error: any;
    try {
      await passkeyClient.api.doRequestWithBearerToken(
        'POST',
        `${passkeyClient.api.baseURL}/passkey/registration/finish`,
        'invalid-token',
        {
          response: { id: 'cred', response: { attestationObject: 'abc' } },
          challenge: 'challenge-abc',
        }
      );
    } catch (err) {
      error = err;
    }

    expect(error).toBeDefined();
    expect(error.code).toBe(401);
  });

  it('POST /passkey/registration/finish - bad payload returns 400', async () => {
    const accessToken = await getMfaAccessTokenForPasskey(passkeyClient);

    let error: any;
    try {
      await passkeyClient.api.doRequestWithBearerToken(
        'POST',
        `${passkeyClient.api.baseURL}/passkey/registration/finish`,
        accessToken,
        {
          // missing required 'challenge' field
          response: { id: 'cred' },
        }
      );
    } catch (err) {
      error = err;
    }

    expect(error).toBeDefined();
    expect(error.code).toBe(400);
  });

  it('POST /passkey/registration/finish - service error propagates', async () => {
    const serviceError = new Error('registration failed');
    mockPasskeyService.verifyRegistrationResponse.mockRejectedValueOnce(serviceError);

    const accessToken = await getMfaAccessTokenForPasskey(passkeyClient);

    let error: any;
    try {
      await passkeyClient.api.doRequestWithBearerToken(
        'POST',
        `${passkeyClient.api.baseURL}/passkey/registration/finish`,
        accessToken,
        {
          response: { id: 'cred', response: { attestationObject: 'abc' } },
          challenge: 'challenge-abc',
        }
      );
    } catch (err) {
      error = err;
    }

    expect(error).toBeDefined();
  });
});

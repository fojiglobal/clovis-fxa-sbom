/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import sinon from 'sinon';
import { assert } from 'chai';
import { Container } from 'typedi';
import { PasskeyService } from '@fxa/accounts/passkey';
import { AppError } from '@fxa/accounts/errors';
import { AccountEventsManager } from '../../../lib/account-events';

const getRoute = require('../../routes_helpers').getRoute;
const mocks = require('../../mocks');

describe('passkeys routes', () => {
  let log: any,
    db: any,
    customs: any,
    statsd: any,
    glean: any,
    routes: any,
    route: any,
    request: any,
    mockPasskeyService: any;

  const UID = 'uid-123';
  const SESSION_TOKEN_ID = 'session-token-456';
  const TEST_EMAIL = 'test@example.com';
  const sandbox = sinon.createSandbox();

  const config = {
    passkeys: {
      enabled: true,
    },
  };

  const mockRegistrationOptions = {
    challenge: 'challenge-abc',
    rp: { name: 'Firefox Accounts', id: 'accounts.firefox.com' },
    user: { id: UID, name: TEST_EMAIL, displayName: TEST_EMAIL },
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

  async function runTest(
    routePath: string,
    requestOptions: any,
    method = 'POST'
  ) {
    const { passkeyRoutes } = require('../../../lib/routes/passkeys');
    routes = passkeyRoutes(customs, db, config, statsd, glean, log);
    route = getRoute(routes, routePath, method);
    request = mocks.mockRequest(requestOptions);
    request.emitMetricsEvent = sandbox.spy(() => Promise.resolve({}));
    return await route.handler(request);
  }

  beforeEach(() => {
    const mockAccountEventsManager = {
      recordSecurityEvent: sandbox.fake(),
    };

    log = mocks.mockLog();
    customs = mocks.mockCustoms();
    statsd = mocks.mockStatsd();
    db = mocks.mockDB({ uid: UID, email: TEST_EMAIL, emailVerified: true });
    glean = mocks.mockGlean();

    mockPasskeyService = {
      generateRegistrationChallenge: sandbox
        .stub()
        .resolves(mockRegistrationOptions),
      verifyRegistrationResponse: sandbox.stub().resolves(mockPasskey),
    };

    Container.set(PasskeyService, mockPasskeyService);
    Container.set(AccountEventsManager, mockAccountEventsManager);
  });

  afterEach(() => {
    sandbox.reset();
    Container.reset();
  });

  describe('isPasskeyFeatureEnabled', () => {
    it('throws featureNotEnabled when passkeys.enabled is false', () => {
      const { isPasskeyFeatureEnabled } = require('../../../lib/passkey-utils');
      const disabledConfig = { passkeys: { enabled: false } };
      assert.throws(
        () => isPasskeyFeatureEnabled(disabledConfig),
        (err: any) => err.errno === AppError.ERRNO.FEATURE_NOT_ENABLED
      );
    });

    it('throws backendServiceFailure when PasskeyService is not in container', () => {
      Container.reset();
      const { isPasskeyFeatureEnabled } = require('../../../lib/passkey-utils');
      assert.throws(
        () => isPasskeyFeatureEnabled(config),
        (err: any) => err.errno === AppError.ERRNO.BACKEND_SERVICE_FAILURE
      );
    });
  });

  describe('POST /passkey/registration/start', () => {
    it('calls PasskeyService.generateRegistrationChallenge and returns options', async () => {
      const result = await runTest('/passkey/registration/start', {
        credentials: {
          uid: UID,
          id: SESSION_TOKEN_ID,
          email: TEST_EMAIL,
        },
      });

      assert.deepEqual(result, mockRegistrationOptions);
      sinon.assert.calledOnce(
        mockPasskeyService.generateRegistrationChallenge
      );
      sinon.assert.calledWith(
        mockPasskeyService.generateRegistrationChallenge,
        UID,
        SESSION_TOKEN_ID
      );
    });

    it('enforces rate limiting via customs.checkAuthenticated', async () => {
      await runTest('/passkey/registration/start', {
        credentials: {
          uid: UID,
          id: SESSION_TOKEN_ID,
          email: TEST_EMAIL,
        },
      });

      sinon.assert.calledWith(
        customs.checkAuthenticated,
        sinon.match.any,
        UID,
        TEST_EMAIL,
        'passkeyRegisterStart'
      );
    });

    it('throws when customs rate limit blocks the request', async () => {
      customs.checkAuthenticated = sandbox
        .stub()
        .rejects(AppError.tooManyRequests(60));

      let error: any;
      try {
        await runTest('/passkey/registration/start', {
          credentials: {
            uid: UID,
            id: SESSION_TOKEN_ID,
            email: TEST_EMAIL,
          },
        });
      } catch (err) {
        error = err;
      }

      assert.isDefined(error);
      assert.equal(error.errno, AppError.ERRNO.THROTTLED);
    });
  });

  describe('POST /passkey/registration/finish', () => {
    const payload = {
      response: { id: 'cred', response: { attestationObject: 'abc' } },
      challenge: 'challenge-abc',
    };

    it('calls PasskeyService.verifyRegistrationResponse and returns passkey', async () => {
      const result = await runTest('/passkey/registration/finish', {
        credentials: {
          uid: UID,
          id: SESSION_TOKEN_ID,
          email: TEST_EMAIL,
        },
        payload,
      });

      assert.equal(result.credentialId, mockPasskey.credentialId);
      assert.equal(result.name, mockPasskey.name);
      assert.deepEqual(result.transports, mockPasskey.transports);
      sinon.assert.calledOnce(mockPasskeyService.verifyRegistrationResponse);
      sinon.assert.calledWith(
        mockPasskeyService.verifyRegistrationResponse,
        UID,
        payload.response,
        payload.challenge
      );
    });

    it('records a success security event on successful registration', async () => {
      const accountEventsManager = Container.get(AccountEventsManager) as any;

      await runTest('/passkey/registration/finish', {
        credentials: {
          uid: UID,
          id: SESSION_TOKEN_ID,
          email: TEST_EMAIL,
        },
        payload,
      });

      sinon.assert.calledOnce(accountEventsManager.recordSecurityEvent);
      const call = accountEventsManager.recordSecurityEvent.getCall(0);
      assert.equal(call.args[1].name, 'account.passkey.registration_success');
    });

    it('records a failure security event and rethrows when service throws', async () => {
      const serviceError = new Error('attestation verification failed');
      mockPasskeyService.verifyRegistrationResponse = sandbox
        .stub()
        .rejects(serviceError);

      const accountEventsManager = Container.get(AccountEventsManager) as any;

      let error: any;
      try {
        await runTest('/passkey/registration/finish', {
          credentials: {
            uid: UID,
            id: SESSION_TOKEN_ID,
            email: TEST_EMAIL,
          },
          payload,
        });
      } catch (err) {
        error = err;
      }

      assert.isDefined(error);
      assert.equal(error.message, 'attestation verification failed');
      sinon.assert.calledOnce(accountEventsManager.recordSecurityEvent);
      const call = accountEventsManager.recordSecurityEvent.getCall(0);
      assert.equal(call.args[1].name, 'account.passkey.registration_failure');
    });

    it('enforces rate limiting via customs.checkAuthenticated', async () => {
      await runTest('/passkey/registration/finish', {
        credentials: {
          uid: UID,
          id: SESSION_TOKEN_ID,
          email: TEST_EMAIL,
        },
        payload,
      });

      sinon.assert.calledWith(
        customs.checkAuthenticated,
        sinon.match.any,
        UID,
        TEST_EMAIL,
        'passkeyRegisterFinish'
      );
    });
  });
});

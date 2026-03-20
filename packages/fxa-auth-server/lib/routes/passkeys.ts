/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import * as isA from 'joi';
import { Container } from 'typedi';
import { StatsD } from 'hot-shots';
import { PasskeyService } from '@fxa/accounts/passkey';
import { AuthRequest } from '../types';
import { recordSecurityEvent } from './utils/security-event';
import { ConfigType } from '../../config';
import { isPasskeyFeatureEnabled } from '../passkey-utils';
import { GleanMetricsType } from '../metrics/glean';
import PASSKEYS_API_DOCS from '../../docs/swagger/passkeys-api';

/** Customs interface for passkey-specific operations */
interface Customs {
  checkAuthenticated: (
    req: AuthRequest,
    uid: string,
    email: string,
    action: string
  ) => Promise<void>;
}

/** DB interface for passkey-specific db operations */
interface DB {
  account(uid: string): Promise<{ email: string }>;
  securityEvent: (arg: any) => Promise<void>;
}

class PasskeyHandler {
  constructor(
    private readonly db: DB,
    private readonly customs: Customs,
    private readonly statsd: StatsD,
    private readonly glean: GleanMetricsType,
    private readonly log: any
  ) {}

  async registrationStart(request: AuthRequest) {
    const { uid, id: sessionTokenId } = request.auth.credentials as {
      uid: string;
      id: string;
    };

    const account = await this.db.account(uid);
    await this.customs.checkAuthenticated(
      request,
      uid,
      account.email,
      'passkeyRegisterStart'
    );

    const service = Container.get(PasskeyService);
    const options = await service.generateRegistrationChallenge(
      uid,
      sessionTokenId
    );

    // TODO: FXA-12914 — Glean event name needs to be defined in the Glean schema
    // await this.glean.passkey.registrationStarted(request);

    return options;
  }

  async registrationFinish(request: AuthRequest) {
    const { uid } = request.auth.credentials as {
      uid: string;
    };

    const account = await this.db.account(uid);
    await this.customs.checkAuthenticated(
      request,
      uid,
      account.email,
      'passkeyRegisterFinish'
    );

    const { response, challenge } = request.payload as {
      response: object;
      challenge: string;
    };

    const service = Container.get(PasskeyService);
    try {
      const passkey = await service.verifyRegistrationResponse(
        uid,
        response,
        challenge
      );

      await recordSecurityEvent('account.passkey.registration_success', {
        db: this.db,
        request,
      });

      // TODO: FXA-12914 — Glean event name needs to be defined in the Glean schema
      // await this.glean.passkey.registrationComplete(request);

      const { credentialId, name, createdAt, lastUsedAt, transports } =
        passkey as {
          credentialId: string;
          name: string;
          createdAt: number;
          lastUsedAt: number;
          transports: string[];
        };

      return { credentialId, name, createdAt, lastUsedAt, transports };
    } catch (err) {
      await recordSecurityEvent('account.passkey.registration_failure', {
        db: this.db,
        request,
      });

      // TODO: FXA-12914 — Glean event name needs to be defined in the Glean schema
      // await this.glean.passkey.registrationFailed(request);

      throw err;
    }
  }
}

export const passkeyRoutes = (
  customs: Customs,
  db: any,
  config: ConfigType,
  statsd: any,
  glean: GleanMetricsType,
  log: any
) => {
  const featureEnabledCheck = () => isPasskeyFeatureEnabled(config);

  const handler = new PasskeyHandler(db, customs, statsd, glean, log);

  return [
    {
      method: 'POST',
      path: '/passkey/registration/start',
      options: {
        ...PASSKEYS_API_DOCS.PASSKEY_REGISTRATION_START_POST,
        pre: [{ method: featureEnabledCheck }],
        auth: {
          strategy: 'mfa',
          scope: ['mfa:passkey'],
          payload: false,
        },
      },
      handler: function (request: AuthRequest) {
        log.begin('passkey.registration.start', request);
        return handler.registrationStart(request);
      },
    },
    {
      method: 'POST',
      path: '/passkey/registration/finish',
      options: {
        ...PASSKEYS_API_DOCS.PASSKEY_REGISTRATION_FINISH_POST,
        pre: [{ method: featureEnabledCheck }],
        auth: {
          strategy: 'mfa',
          scope: ['mfa:passkey'],
          payload: false,
        },
        validate: {
          payload: isA.object({
            response: isA.object().required(),
            challenge: isA.string().required(),
          }),
        },
        response: {
          schema: isA.object({
            credentialId: isA.string().required(),
            name: isA.string().required(),
            createdAt: isA.number().required(),
            lastUsedAt: isA.number().required(),
            transports: isA.array().items(isA.string()).required(),
          }),
        },
      },
      handler: function (request: AuthRequest) {
        log.begin('passkey.registration.finish', request);
        return handler.registrationFinish(request);
      },
    },
  ];
};

export default passkeyRoutes;

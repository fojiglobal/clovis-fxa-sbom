/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Container } from 'typedi';
import { ConfigType } from '../config';
import { AppError } from '@fxa/accounts/errors';
import { PasskeyService } from '@fxa/accounts/passkey';

/**
 * Checks if the passkey feature is enabled in the configuration and that
 * PasskeyService is available in the DI container. It is possible for the
 * passkey feature to be disabled due to invalid configuration even if the
 * "enabled" flag is set to true. (FXA-13069)
 * @param config - The application configuration object
 * @returns true if the passkey feature is enabled and the service is available
 * @throws AppError.featureNotEnabled if the feature flag is disabled
 * @throws AppError.backendServiceFailure if PasskeyService is not in the container
 */
export function isPasskeyFeatureEnabled(config: ConfigType): boolean {
  if (!config.passkeys.enabled) {
    throw AppError.featureNotEnabled();
  }
  if (!Container.has(PasskeyService)) {
    throw AppError.backendServiceFailure('passkey', 'unavailable');
  }
  return true;
}

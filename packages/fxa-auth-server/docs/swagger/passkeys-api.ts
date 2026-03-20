/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import dedent from 'dedent';
import TAGS from './swagger-tags';

const TAGS_PASSKEYS = {
  tags: TAGS.PASSKEYS,
};

const PASSKEY_REGISTRATION_START_POST = {
  ...TAGS_PASSKEYS,
  description: '/passkey/registration/start',
  notes: [
    dedent`
      🔒 Authenticated with MFA JWT (scope: mfa:passkey)

      Initiates the WebAuthn registration ceremony by generating a challenge and
      registration options for the authenticator. The returned options should be
      passed to the WebAuthn client-side API (navigator.credentials.create).
    `,
  ],
};

const PASSKEY_REGISTRATION_FINISH_POST = {
  ...TAGS_PASSKEYS,
  description: '/passkey/registration/finish',
  notes: [
    dedent`
      🔒 Authenticated with MFA JWT (scope: mfa:passkey)

      Completes the WebAuthn registration ceremony by verifying the attestation
      response from the authenticator. On success, stores the new passkey credential
      and returns its metadata.
    `,
  ],
};

const PASSKEYS_API_DOCS = {
  PASSKEY_REGISTRATION_START_POST,
  PASSKEY_REGISTRATION_FINISH_POST,
};

export default PASSKEYS_API_DOCS;

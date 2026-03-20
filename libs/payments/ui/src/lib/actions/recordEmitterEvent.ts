/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
'use server';

import { getApp } from '../nestapp/app';
import { flattenRouteParams } from '../utils/flatParam';
import { getAdditionalRequestArgs } from '../utils/getAdditionalRequestArgs';
import { PaymentProvidersType } from '@fxa/payments/customer';
import { PaymentsEmitterEventsKeysType } from '@fxa/payments/events';

async function recordEmitterEventAction(
  eventName: 'checkoutSubmit',
  params: Record<string, string | string[] | undefined>,
  searchParams: Record<string, string | string[] | undefined>,
  paymentProvider: PaymentProvidersType,
  isFreeTrial?: boolean
): Promise<void>;
async function recordEmitterEventAction(
  eventName:
    | 'checkoutView'
    | 'checkoutEngage'
    | 'checkoutSuccess'
    | 'checkoutFail',
  params: Record<string, string | string[] | undefined>,
  searchParams: Record<string, string | string[] | undefined>,
  paymentProvider?: undefined,
  isFreeTrial?: boolean
): Promise<void>;
async function recordEmitterEventAction(
  eventName: PaymentsEmitterEventsKeysType,
  params: Record<string, string | string[] | undefined>,
  searchParams: Record<string, string | string[] | undefined>,
  paymentProvider?: PaymentProvidersType,
  isFreeTrial?: boolean
) {
  const requestArgs = {
    ...(await getAdditionalRequestArgs()),
    isFreeTrial: isFreeTrial ?? false,
    params: flattenRouteParams(params),
    searchParams: flattenRouteParams(searchParams),
  };

  return getApp().getActionsService().recordEmitterEvent({
    eventName,
    requestArgs,
    paymentProvider,
  });
}

export { recordEmitterEventAction };

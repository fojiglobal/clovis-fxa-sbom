/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithRouter } from '../../../models/mocks';
import { usePageViewEvent } from '../../../lib/metrics';
import { REACT_ENTRYPOINT, ENTRYPOINTS } from '../../../constants';
import GleanMetrics from '../../../lib/glean';
import firefox from '../../../lib/channels/firefox';
import { MOCK_ERROR } from './mocks';
import Pair, { viewName } from '.';

jest.mock('../../../lib/metrics', () => ({
  usePageViewEvent: jest.fn(),
}));

jest.mock('../../../lib/channels/firefox', () => ({
  __esModule: true,
  default: {
    send: jest.fn(),
  },
  FirefoxCommand: {
    PairPreferences: 'fxaccounts:pair_preferences',
  },
}));

jest.mock('../../../lib/glean', () => ({
  __esModule: true,
  default: {
    cadFireFox: {
      choiceView: jest.fn(),
      view: jest.fn(),
      choiceEngage: jest.fn(),
      choiceSubmit: jest.fn(),
      choiceNotnowSubmit: jest.fn(),
      notnowSubmit: jest.fn(),
      syncDeviceSubmit: jest.fn(),
    },
  },
}));

describe('Pair', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('entrypoint-based QR code view', () => {
    it('renders the page with a QR code with a valid entrypoint', () => {
      renderWithRouter(
        <Pair entryPoint={ENTRYPOINTS.FIREFOX_FX_VIEW_ENTRYPOINT} />
      );
      const headingEl = screen.getByRole('heading', { level: 1 });
      expect(headingEl).toHaveTextContent('Connect Firefox on another device');
      expect(
        screen.getByText('Already have Firefox on a phone or tablet?')
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Sync your device' })
      ).toBeInTheDocument();
      expect(
        screen.getByRole('heading', { level: 2, name: 'Or download' })
      ).toBeInTheDocument();
      expect(screen.getByRole('img', { name: 'QR code' })).toBeInTheDocument();
    });

    it('sends pair_preferences WebChannel command on Sync your device click', () => {
      renderWithRouter(
        <Pair entryPoint={ENTRYPOINTS.FIREFOX_FX_VIEW_ENTRYPOINT} />
      );
      fireEvent.click(
        screen.getByRole('button', { name: 'Sync your device' })
      );
      expect(firefox.send).toHaveBeenCalledWith(
        'fxaccounts:pair_preferences',
        {}
      );
    });
  });

  describe('choice screen (no entrypoint)', () => {
    it('renders the choice screen by default', () => {
      renderWithRouter(<Pair />);
      expect(
        screen.getByText('Sync your Firefox experience')
      ).toBeInTheDocument();
      expect(
        screen.getByText('Select an option to continue:')
      ).toBeInTheDocument();
      expect(
        screen.getByLabelText(/I already have Firefox for mobile/)
      ).toBeInTheDocument();
      expect(
        screen.getByLabelText(/I don't have Firefox for mobile/)
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Continue' })
      ).toBeDisabled();
      expect(
        screen.getByTestId('pair-choice-icon-has-mobile')
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('pair-choice-icon-needs-mobile')
      ).toBeInTheDocument();
    });

    it('fires choiceView Glean event on render', () => {
      renderWithRouter(<Pair />);
      expect(GleanMetrics.cadFireFox.choiceView).toHaveBeenCalled();
    });

    it('enables Continue button after selecting a radio', () => {
      renderWithRouter(<Pair />);
      fireEvent.click(
        screen.getByLabelText(/I already have Firefox for mobile/)
      );
      expect(
        screen.getByRole('button', { name: 'Continue' })
      ).not.toBeDisabled();
    });

    it('fires choiceEngage with "has mobile" reason', () => {
      renderWithRouter(<Pair />);
      fireEvent.click(
        screen.getByLabelText(/I already have Firefox for mobile/)
      );
      expect(GleanMetrics.cadFireFox.choiceEngage).toHaveBeenCalledWith({
        event: { reason: 'has mobile' },
      });
    });

    it('fires choiceEngage with "does not have mobile" reason', () => {
      renderWithRouter(<Pair />);
      fireEvent.click(
        screen.getByLabelText(/I don't have Firefox for mobile/)
      );
      expect(GleanMetrics.cadFireFox.choiceEngage).toHaveBeenCalledWith({
        event: { reason: 'does not have mobile' },
      });
    });

    it('sends pair_preferences when "has mobile" is selected and Continue is clicked', () => {
      renderWithRouter(<Pair />);
      fireEvent.click(
        screen.getByLabelText(/I already have Firefox for mobile/)
      );
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      expect(GleanMetrics.cadFireFox.choiceSubmit).toHaveBeenCalledWith({
        event: { reason: 'has mobile' },
      });
      expect(firefox.send).toHaveBeenCalledWith(
        'fxaccounts:pair_preferences',
        {}
      );
    });

    it('transitions to download screen when "needs mobile" is selected and Continue is clicked', () => {
      renderWithRouter(<Pair />);
      fireEvent.click(
        screen.getByLabelText(/I don't have Firefox for mobile/)
      );
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      expect(GleanMetrics.cadFireFox.choiceSubmit).toHaveBeenCalledWith({
        event: { reason: 'does not have mobile' },
      });
      expect(
        screen.getByText('Download Firefox for mobile')
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Continue to sync' })
      ).toBeInTheDocument();
    });

    it('fires choiceNotnowSubmit when "Not now" is clicked on choice screen', () => {
      renderWithRouter(<Pair />);
      fireEvent.click(screen.getByText('Not now'));
      expect(GleanMetrics.cadFireFox.choiceNotnowSubmit).toHaveBeenCalled();
    });
  });

  describe('download screen', () => {
    function renderAndNavigateToDownload() {
      renderWithRouter(<Pair />);
      fireEvent.click(
        screen.getByLabelText(/I don't have Firefox for mobile/)
      );
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    }

    it('renders download screen with QR code and instructions', () => {
      renderAndNavigateToDownload();
      expect(
        screen.getByText('Download Firefox for mobile')
      ).toBeInTheDocument();
      expect(
        screen.getByText(/To sync Firefox on your phone or tablet/)
      ).toBeInTheDocument();
      expect(screen.getByRole('img', { name: 'QR code' })).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Continue to sync' })
      ).toBeInTheDocument();
    });

    it('fires view Glean event when download screen renders', () => {
      renderAndNavigateToDownload();
      expect(GleanMetrics.cadFireFox.view).toHaveBeenCalled();
    });

    it('sends pair_preferences on "Continue to sync"', () => {
      renderAndNavigateToDownload();
      fireEvent.click(
        screen.getByRole('button', { name: 'Continue to sync' })
      );
      expect(GleanMetrics.cadFireFox.syncDeviceSubmit).toHaveBeenCalled();
      expect(firefox.send).toHaveBeenCalledWith(
        'fxaccounts:pair_preferences',
        {}
      );
    });

    it('fires notnowSubmit when "Not now" is clicked on download screen', () => {
      renderAndNavigateToDownload();
      fireEvent.click(screen.getByText('Not now'));
      expect(GleanMetrics.cadFireFox.notnowSubmit).toHaveBeenCalled();
    });

    it('navigates back to choice screen on back button', async () => {
      renderAndNavigateToDownload();
      const backButton = screen.getByTitle('Back');
      fireEvent.click(backButton);
      await waitFor(() => {
        expect(
          screen.getByText('Select an option to continue:')
        ).toBeInTheDocument();
      });
    });
  });

  describe('general', () => {
    it('renders any arising errors on choice screen', () => {
      renderWithRouter(<Pair error={MOCK_ERROR} />);
      expect(screen.getByText(MOCK_ERROR)).toBeInTheDocument();
    });

    it('emits expected page view metric on render', () => {
      renderWithRouter(<Pair />);
      expect(usePageViewEvent).toHaveBeenCalledWith(
        viewName,
        REACT_ENTRYPOINT
      );
    });
  });
});

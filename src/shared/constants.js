(function initConstants(global) {
  const Tango = global.Tango = global.Tango || {};

  Tango.VERSION = '0.2.3';
  Tango.STORAGE_KEY = 'tangoPaperTraderStateV1';
  Tango.SETTINGS_KEY = 'tangoPaperTraderSettingsV1';
  Tango.QUOTE_STALE_MS = 15_000;
  Tango.MAX_TRADES = 10_000;

  Tango.DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    language: 'auto',
    displayCurrency: 'SOL',
    theme: 'auto',
    fastMode: false,
    confirmationEnabled: true,
    soundEnabled: true,
    buyPresets: [0.1, 0.2, 0.5, 1, 2, 3, 5, 10],
    sellPresets: [10, 25, 50, 100, 5, 15, 35, 75],
    slippageBps: 80,
    platformFeeBps: 100,
    networkFeeSol: 0.001,
    showListQuickBuy: true,
    pnlBarPosition: 'bottom',
    panelPosition: null,
    drawerPosition: null,
    barPosition: null,
    barCollapsed: false,
    panelCollapsed: false,
    initialBalanceSol: 100
  });

  Tango.createInitialState = function createInitialState(initialBalanceSol) {
    const balance = Number.isFinite(Number(initialBalanceSol)) && Number(initialBalanceSol) > 0
      ? Number(initialBalanceSol)
      : Tango.DEFAULT_SETTINGS.initialBalanceSol;
    const now = Date.now();
    return {
      schemaVersion: 1,
      account: {
        initialBalanceSol: balance,
        cashBalanceSol: balance,
        realizedPnlSol: 0,
        createdAt: now,
        updatedAt: now
      },
      positions: {},
      trades: [],
      dailyRealized: {},
      initialized: false
    };
  };
})(globalThis);

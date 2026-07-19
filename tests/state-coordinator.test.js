const test = require('node:test');
const assert = require('node:assert/strict');

global.Tango = {};
require('../src/core/chains.js');
require('../src/shared/constants.js');
const State = require('../src/core/state.js');
const Engine = require('../src/core/engine.js');
const StateCoordinator = require('../src/core/state-coordinator.js');

function memoryPersistence(initialState, initialSettings) {
  const values = {
    [global.Tango.STORAGE_KEY]: structuredClone(initialState),
    [global.Tango.SETTINGS_KEY]: structuredClone(initialSettings)
  };
  const writes = [];
  return {
    values, writes,
    async readRaw(keys) {
      await Promise.resolve();
      return Object.fromEntries(keys.filter((key) => key in values).map((key) => [key, structuredClone(values[key])]));
    },
    async writeRaw(next) {
      await Promise.resolve();
      writes.push(structuredClone(next));
      Object.assign(values, structuredClone(next));
    }
  };
}

test('serializes buys from two contexts without losing either chain', async () => {
  const initial = State.createInitialState({ now: 1 });
  initial.initialized = true;
  const settings = State.normalizeSettings({
    slippageBps: 0,
    platformFeeBps: 0,
    chains: {
      eth: { networkFeeNative: 0 },
      bsc: { networkFeeNative: 0 }
    }
  });
  const persistence = memoryPersistence(initial, settings);
  const coordinator = StateCoordinator.create({
    readRaw: persistence.readRaw,
    writeRaw: persistence.writeRaw,
    now: () => 1_000
  });
  const quote = {
    priceUsd: 2, nativePriceUsd: 2_000,
    observedAt: 1_000, nativePriceObservedAt: 1_000
  };

  const [eth, bsc] = await Promise.all([
    coordinator.mutate({
      type: 'EXECUTE_BUY',
      order: {
        token: { chain: 'eth', address: '0x1111111111111111111111111111111111111111' },
        quote,
        amountNative: 1
      }
    }),
    coordinator.mutate({
      type: 'EXECUTE_BUY',
      order: {
        token: { chain: 'bsc', address: '0x2222222222222222222222222222222222222222' },
        quote,
        amountNative: 1
      }
    })
  ]);

  const final = await coordinator.getAll();
  assert.equal(eth.trade.chain, 'eth');
  assert.equal(bsc.trade.chain, 'bsc');
  assert.equal(final.state.accounts.eth.cashBalanceNative, 9);
  assert.equal(final.state.accounts.bsc.cashBalanceNative, 9);
  assert.deepEqual(Object.keys(final.state.positions).sort(), [
    Engine.positionKey('bsc', '0x2222222222222222222222222222222222222222'),
    Engine.positionKey('eth', '0x1111111111111111111111111111111111111111')
  ]);
  assert.equal(final.state.stateRevision, 2);
});

test('serializes scoped settings patches from stale Popup, Dashboard, and content snapshots', async () => {
  const initial = State.createInitialState({ now: 1 });
  const settings = State.normalizeSettings({
    selectedChain: 'sol',
    language: 'zh-CN',
    displayCurrency: 'USD',
    theme: 'dark',
    chains: {
      eth: { buyPresets: [0.25, 0.5], networkFeeNative: 0.002, initialBalanceNative: 20 },
      bsc: { buyPresets: [1, 2], networkFeeNative: 0.003, initialBalanceNative: 30 },
      base: { buyPresets: [3, 4], networkFeeNative: 0.004, initialBalanceNative: 40 }
    }
  });
  const popupSnapshot = structuredClone(settings);
  const dashboardSnapshot = structuredClone(settings);
  const contentSnapshot = structuredClone(settings);
  const persistence = memoryPersistence(initial, settings);
  const coordinator = StateCoordinator.create({
    readRaw: persistence.readRaw,
    writeRaw: persistence.writeRaw
  });

  await Promise.all([
    coordinator.mutate({
      type: 'PATCH_SETTINGS',
      patch: { selectedChain: popupSnapshot.selectedChain === 'sol' ? 'base' : 'sol' }
    }),
    coordinator.mutate({
      type: 'PATCH_SETTINGS',
      patch: {
        theme: dashboardSnapshot.theme === 'dark' ? 'light' : 'dark',
        chains: { eth: { networkFeeNative: dashboardSnapshot.chains.eth.networkFeeNative + 0.01 } }
      }
    }),
    coordinator.mutate({
      type: 'PATCH_SETTINGS',
      patch: {
        sellPresets: contentSnapshot.sellPresets.slice().reverse(),
        chains: { bsc: { buyPresets: [...contentSnapshot.chains.bsc.buyPresets, 3] } }
      }
    })
  ]);

  const final = (await coordinator.getAll()).settings;
  assert.equal(final.selectedChain, 'base');
  assert.equal(final.language, 'zh-CN');
  assert.equal(final.displayCurrency, 'USD');
  assert.equal(final.theme, 'light');
  assert.deepEqual(final.sellPresets, settings.sellPresets.slice().reverse());
  assert.equal(final.chains.eth.networkFeeNative, 0.012);
  assert.deepEqual(final.chains.eth.buyPresets, settings.chains.eth.buyPresets);
  assert.equal(final.chains.eth.initialBalanceNative, settings.chains.eth.initialBalanceNative);
  assert.deepEqual(final.chains.bsc.buyPresets, [1, 2, 3]);
  assert.equal(final.chains.bsc.networkFeeNative, settings.chains.bsc.networkFeeNative);
  assert.equal(final.chains.bsc.initialBalanceNative, settings.chains.bsc.initialBalanceNative);
  for (const chain of global.Tango.Chains.all().filter(({ id }) => !['eth', 'bsc'].includes(id))) {
    assert.deepEqual(final.chains[chain.id], settings.chains[chain.id]);
  }
});

test('a rejected settings patch does not poison later queued settings mutations', async () => {
  const initial = State.createInitialState({ now: 1 });
  const settings = State.normalizeSettings({ selectedChain: 'sol', language: 'en' });
  const persistence = memoryPersistence(initial, settings);
  const coordinator = StateCoordinator.create({
    readRaw: persistence.readRaw,
    writeRaw: persistence.writeRaw
  });

  const rejected = coordinator.mutate({
    type: 'PATCH_SETTINGS',
    patch: { chains: { eth: { networkFeeNative: Infinity } } }
  });
  const accepted = coordinator.mutate({
    type: 'PATCH_SETTINGS',
    patch: { selectedChain: 'bsc' }
  });

  await assert.rejects(rejected, /invalidSettings/);
  assert.equal((await accepted).settings.selectedChain, 'bsc');
  const final = (await coordinator.getAll()).settings;
  assert.equal(final.selectedChain, 'bsc');
  assert.equal(final.language, 'en');
});

test('serializes periodic quote and metadata writes with a trade from another context', async () => {
  const address = 'So11111111111111111111111111111111111111112';
  const settings = State.normalizeSettings({
    slippageBps: 0,
    platformFeeBps: 0,
    chains: { sol: { networkFeeNative: 0 }, bsc: { networkFeeNative: 0 } }
  });
  const base = State.createInitialState({ now: 1 });
  base.initialized = true;
  const bought = Engine.executeBuy(base, {
    token: {
      chain: 'sol', address, symbol: 'OLD', name: 'Old',
      metadataVerified: true, metadataSource: 'GMGN_TRENCH'
    },
    quote: { priceUsd: 2, nativePriceUsd: 100, observedAt: 1_000, nativePriceObservedAt: 1_000 },
    amountNative: 1
  }, settings, 1_000).state;
  const persistence = memoryPersistence(bought, settings);
  const coordinator = StateCoordinator.create({
    readRaw: persistence.readRaw,
    writeRaw: persistence.writeRaw,
    now: () => 2_000
  });

  await Promise.all([
    coordinator.mutate({
      type: 'UPDATE_POSITION_QUOTE',
      token: { chain: 'sol', address },
      quote: {
        priceUsd: 3, nativePriceUsd: 120,
        observedAt: 2_000, nativePriceObservedAt: 2_000
      }
    }),
    coordinator.mutate({
      type: 'EXECUTE_BUY',
      order: {
        token: { chain: 'bsc', address: '0x3333333333333333333333333333333333333333' },
        quote: {
          priceUsd: 2, nativePriceUsd: 600,
          observedAt: 2_000, nativePriceObservedAt: 2_000
        },
        amountNative: 1
      }
    }),
    coordinator.mutate({
      type: 'UPDATE_POSITION_METADATA',
      token: {
        chain: 'sol', address, symbol: 'NEW', name: 'New',
        metadataVerified: true, metadataSource: 'GMGN_DETAIL'
      }
    })
  ]);

  const final = (await coordinator.getAll()).state;
  const position = final.positions[Engine.positionKey('sol', address)];
  assert.equal(position.lastPriceUsd, 3);
  assert.equal(position.lastNativePriceUsd, 120);
  assert.equal(position.symbol, 'NEW');
  assert.equal(final.accounts.bsc.cashBalanceNative, 9);
  assert.ok(final.positions[Engine.positionKey('bsc', '0x3333333333333333333333333333333333333333')]);
  assert.equal(final.stateRevision, 3);
});

test('rejects a stale whole-state replacement by revision instead of erasing a newer mutation', async () => {
  const initial = State.createInitialState({ now: 1 });
  initial.initialized = true;
  const settings = State.normalizeSettings({});
  const persistence = memoryPersistence(initial, settings);
  const coordinator = StateCoordinator.create({
    readRaw: persistence.readRaw,
    writeRaw: persistence.writeRaw,
    now: () => 2_000
  });
  const left = structuredClone((await coordinator.getAll()).state);
  const right = structuredClone(left);
  left.accounts.eth.cashBalanceNative = 8;
  right.accounts.bsc.cashBalanceNative = 7;

  await coordinator.mutate({ type: 'REPLACE_STATE', state: left, expectedRevision: left.stateRevision });
  await assert.rejects(
    coordinator.mutate({ type: 'REPLACE_STATE', state: right, expectedRevision: right.stateRevision }),
    /stateConflict/
  );

  const final = (await coordinator.getAll()).state;
  assert.equal(final.accounts.eth.cashBalanceNative, 8);
  assert.equal(final.accounts.bsc.cashBalanceNative, 10);
  assert.equal(final.stateRevision, 1);
});

test('a sell queued from another context executes against the latest committed buy', async () => {
  const initial = State.createInitialState({ now: 1 });
  initial.initialized = true;
  const settings = State.normalizeSettings({
    slippageBps: 0,
    platformFeeBps: 0,
    chains: { eth: { networkFeeNative: 0 } }
  });
  const persistence = memoryPersistence(initial, settings);
  let clock = 1_000;
  const coordinator = StateCoordinator.create({
    readRaw: persistence.readRaw,
    writeRaw: persistence.writeRaw,
    now: () => clock++
  });
  const token = { chain: 'eth', address: '0x4444444444444444444444444444444444444444' };
  const quote = {
    priceUsd: 2, nativePriceUsd: 2_000,
    observedAt: 1_000, nativePriceObservedAt: 1_000
  };

  const buy = coordinator.mutate({ type: 'EXECUTE_BUY', order: { token, quote, amountNative: 1 } });
  const sell = coordinator.mutate({
    type: 'EXECUTE_SELL',
    order: { token, quote: { ...quote, priceUsd: 3, observedAt: 1_001 }, percent: 100 }
  });
  const [, sold] = await Promise.all([buy, sell]);

  const final = (await coordinator.getAll()).state;
  assert.equal(sold.trade.side, 'SELL');
  assert.equal(final.positions[Engine.positionKey(token.chain, token.address)], undefined);
  assert.equal(final.trades.length, 2);
  assert.equal(final.stateRevision, 2);
});

test('stale native observations cannot mutate buy, sell, or close-all state and the queue recovers', async () => {
  const settings = State.normalizeSettings({
    slippageBps: 0,
    platformFeeBps: 0,
    chains: { eth: { networkFeeNative: 0 } }
  });
  const base = State.createInitialState({ now: 1 });
  base.initialized = true;
  const heldToken = { chain: 'eth', address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' };
  const laterToken = { chain: 'eth', address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' };
  const freshQuote = {
    priceUsd: 2,
    nativePriceUsd: 2_000,
    observedAt: 50_000,
    nativePriceObservedAt: 50_000
  };
  const held = Engine.executeBuy(base, {
    token: heldToken, quote: freshQuote, amountNative: 1
  }, settings, 50_000).state;
  const before = structuredClone(held);
  const persistence = memoryPersistence(held, settings);
  const coordinator = StateCoordinator.create({
    readRaw: persistence.readRaw,
    writeRaw: persistence.writeRaw,
    now: () => 50_000
  });
  const staleNativeQuote = { ...freshQuote, priceUsd: 3, nativePriceObservedAt: 1 };

  const buy = coordinator.mutate({
    type: 'EXECUTE_BUY',
    order: { token: laterToken, quote: staleNativeQuote, amountNative: 1 }
  });
  const sell = coordinator.mutate({
    type: 'EXECUTE_SELL',
    order: { token: heldToken, quote: staleNativeQuote, percent: 50 }
  });
  const close = coordinator.mutate({
    type: 'EXECUTE_CLOSE_ALL',
    chain: 'eth',
    orders: [{ token: heldToken, quote: staleNativeQuote }]
  });

  await assert.rejects(buy, /staleQuote/);
  await assert.rejects(sell, /staleQuote/);
  const closeResult = await close;
  assert.equal(closeResult.trades.length, 0);
  assert.equal(closeResult.failures.length, 1);
  assert.equal(closeResult.failures[0].reason, 'staleQuote');
  assert.equal(persistence.writes.length, 0);
  assert.deepEqual(persistence.values[global.Tango.STORAGE_KEY], before);

  const committed = await coordinator.mutate({
    type: 'EXECUTE_BUY',
    order: { token: laterToken, quote: freshQuote, amountNative: 1 }
  });
  assert.equal(persistence.writes.length, 1);
  assert.ok(committed.state.positions[Engine.positionKey(laterToken.chain, laterToken.address)]);
  assert.deepEqual(
    committed.state.positions[Engine.positionKey(heldToken.chain, heldToken.address)],
    before.positions[Engine.positionKey(heldToken.chain, heldToken.address)]
  );
});

test('close-all and reset commands mutate the latest queued state under the same coordinator', async () => {
  const initial = State.createInitialState({ now: 1 });
  initial.initialized = true;
  const settings = State.normalizeSettings({
    slippageBps: 0,
    platformFeeBps: 0,
    chains: { eth: { networkFeeNative: 0 }, bsc: { networkFeeNative: 0 } }
  });
  const persistence = memoryPersistence(initial, settings);
  const coordinator = StateCoordinator.create({
    readRaw: persistence.readRaw,
    writeRaw: persistence.writeRaw,
    now: () => 1_000
  });
  const eth = { chain: 'eth', address: '0x5555555555555555555555555555555555555555' };
  const bsc = { chain: 'bsc', address: '0x6666666666666666666666666666666666666666' };
  const quote = {
    priceUsd: 2, nativePriceUsd: 2_000,
    observedAt: 1_000, nativePriceObservedAt: 1_000
  };
  await coordinator.mutate({ type: 'EXECUTE_BUY', order: { token: eth, quote, amountNative: 1 } });
  await coordinator.mutate({ type: 'EXECUTE_BUY', order: { token: bsc, quote, amountNative: 1 } });

  const closed = await coordinator.mutate({
    type: 'EXECUTE_CLOSE_ALL', chain: 'eth', orders: [{ token: eth, quote }]
  });
  assert.equal(closed.trades.length, 1);
  assert.equal(closed.state.positions[Engine.positionKey(eth.chain, eth.address)], undefined);
  assert.ok(closed.state.positions[Engine.positionKey(bsc.chain, bsc.address)]);

  const resetChain = await coordinator.mutate({ type: 'RESET_CHAIN', chain: 'bsc', balanceNative: 25 });
  assert.equal(resetChain.state.accounts.bsc.cashBalanceNative, 25);
  assert.equal(resetChain.state.positions[Engine.positionKey(bsc.chain, bsc.address)], undefined);
  const resetAll = await coordinator.mutate({ type: 'RESET_ALL' });
  assert.equal(resetAll.state.accounts.bsc.cashBalanceNative, 25);
  assert.equal(resetAll.state.accounts.eth.cashBalanceNative, 10);
  assert.equal(resetAll.state.stateRevision, 5);
});

test('selected-chain reset atomically commits its custom principal to state and settings', async () => {
  const initial = State.createInitialState({ now: 1 });
  initial.initialized = true;
  initial.accounts.eth.cashBalanceNative = 4;
  initial.accounts.bsc.cashBalanceNative = 7;
  initial.dailyRealizedByChain.eth['2026-01-01'] = { native: -1, usdAtExecution: -2_000 };
  const settings = State.normalizeSettings({
    selectedChain: 'base',
    language: 'zh-CN',
    chains: {
      eth: { buyPresets: [0.25, 0.5], networkFeeNative: 0.002, initialBalanceNative: 20 },
      bsc: { buyPresets: [1, 2], networkFeeNative: 0.003, initialBalanceNative: 30 }
    }
  });
  const beforeState = structuredClone(initial);
  const beforeSettings = structuredClone(settings);
  const persistence = memoryPersistence(initial, settings);
  const coordinator = StateCoordinator.create({
    readRaw: persistence.readRaw,
    writeRaw: persistence.writeRaw,
    now: () => 2_000
  });

  const committed = await coordinator.mutate({ type: 'RESET_CHAIN', chain: 'eth', balanceNative: 42 });

  assert.equal(persistence.writes.length, 1);
  assert.deepEqual(Object.keys(persistence.writes[0]).sort(), [
    global.Tango.SETTINGS_KEY,
    global.Tango.STORAGE_KEY
  ].sort());
  assert.equal(committed.state.stateRevision, beforeState.stateRevision + 1);
  assert.equal(committed.state.accounts.eth.initialBalanceNative, 42);
  assert.equal(committed.state.accounts.eth.cashBalanceNative, 42);
  assert.deepEqual(committed.state.dailyRealizedByChain.eth, {});
  assert.equal(committed.settings.chains.eth.initialBalanceNative, 42);
  assert.deepEqual(committed.state.accounts.bsc, beforeState.accounts.bsc);
  assert.deepEqual(committed.state.dailyRealizedByChain.bsc, beforeState.dailyRealizedByChain.bsc);
  assert.deepEqual(committed.settings.chains.bsc, beforeSettings.chains.bsc);
  assert.equal(committed.settings.selectedChain, beforeSettings.selectedChain);
  assert.equal(committed.settings.language, beforeSettings.language);
});

test('invalid selected-chain reset principals never write and do not poison the queue', async () => {
  const initial = State.createInitialState({ now: 1 });
  initial.initialized = true;
  initial.accounts.eth.cashBalanceNative = 4;
  const settings = State.normalizeSettings({
    selectedChain: 'sol',
    chains: { eth: { initialBalanceNative: 20 }, bsc: { initialBalanceNative: 30 } }
  });
  const beforeState = structuredClone(initial);
  const beforeSettings = structuredClone(settings);
  const persistence = memoryPersistence(initial, settings);
  const coordinator = StateCoordinator.create({
    readRaw: persistence.readRaw,
    writeRaw: persistence.writeRaw,
    now: () => 2_000
  });

  for (const balanceNative of [Infinity, NaN, 0, -1, 1e15 + 1, '10', null, true, {}]) {
    await assert.rejects(
      coordinator.mutate({ type: 'RESET_CHAIN', chain: 'eth', balanceNative }),
      /invalidResetPrincipal/
    );
    assert.equal(persistence.writes.length, 0);
  }
  await assert.rejects(
    coordinator.mutate({ type: 'RESET_CHAIN', chain: 'unknown', balanceNative: 10 }),
    /unsupportedChain/
  );
  assert.equal(persistence.writes.length, 0);
  assert.deepEqual(persistence.values[global.Tango.STORAGE_KEY], beforeState);
  assert.deepEqual(persistence.values[global.Tango.SETTINGS_KEY], beforeSettings);

  const rejected = coordinator.mutate({ type: 'RESET_CHAIN', chain: 'eth', balanceNative: Infinity });
  const accepted = coordinator.mutate({ type: 'RESET_CHAIN', chain: 'bsc', balanceNative: 25 });
  await assert.rejects(rejected, /invalidResetPrincipal/);
  const committed = await accepted;
  assert.equal(persistence.writes.length, 1);
  assert.equal(committed.state.accounts.bsc.cashBalanceNative, 25);
  assert.equal(committed.settings.chains.bsc.initialBalanceNative, 25);
  assert.equal(committed.state.accounts.eth.cashBalanceNative, beforeState.accounts.eth.cashBalanceNative);
  assert.equal(committed.settings.chains.eth.initialBalanceNative, beforeSettings.chains.eth.initialBalanceNative);
});

test('imports normalize before one queued atomic state-and-settings write', async () => {
  const initial = State.createInitialState({ now: 1 });
  initial.initialized = true;
  const settings = State.normalizeSettings({ selectedChain: 'eth' });
  const persistence = memoryPersistence(initial, settings);
  const coordinator = StateCoordinator.create({
    readRaw: persistence.readRaw,
    writeRaw: persistence.writeRaw,
    now: () => 2_000
  });
  const importedState = State.createInitialState({ now: 100 });
  importedState.initialized = true;
  importedState.accounts.bsc.cashBalanceNative = 7;
  const importedSettings = State.normalizeSettings({ selectedChain: 'base' });
  const payload = {
    product: 'Tango Paper Trader',
    version: '0.3.0',
    exportedAt: 1_500,
    state: importedState,
    settings: importedSettings
  };

  const imported = await coordinator.mutate({ type: 'IMPORT', payload });
  assert.equal(imported.state.accounts.bsc.cashBalanceNative, 7);
  assert.equal(imported.state.stateRevision, 1);
  assert.equal(imported.settings.selectedChain, 'base');

  const invalid = structuredClone(payload);
  invalid.state.positions['wrong-key'] = {
    chain: 'eth', tokenAddress: 'bad', quantity: 1, costBasisNative: 1
  };
  await assert.rejects(coordinator.mutate({ type: 'IMPORT', payload: invalid }), /invalidPosition/);
  const afterFailure = await coordinator.getAll();
  assert.equal(afterFailure.state.accounts.bsc.cashBalanceNative, 7);
  assert.equal(afterFailure.state.stateRevision, 1);
  assert.equal(afterFailure.settings.selectedChain, 'base');

  for (const value of [null, false, '']) {
    const malformedAccount = structuredClone(payload);
    malformedAccount.state.accounts.eth.cashBalanceNative = value;
    await assert.rejects(coordinator.mutate({ type: 'IMPORT', payload: malformedAccount }), /invalidAccount/);
    const afterMalformedAccount = await coordinator.getAll();
    assert.equal(afterMalformedAccount.state.accounts.bsc.cashBalanceNative, 7);
    assert.equal(afterMalformedAccount.state.stateRevision, 1);
    assert.equal(afterMalformedAccount.settings.selectedChain, 'base');
  }

  const malformedTrade = structuredClone(payload);
  malformedTrade.state.trades = [{
    id: 'bad', chain: 'eth', tokenAddress: 'bad', side: 'BUY', quantity: -1,
    amountNative: Infinity, observedPriceUsd: 1, executionPriceUsd: 1,
    marketCapUsd: 0, liquidityUsd: 0, nativePriceUsd: 2_000, slippageBps: 0,
    platformFeeNative: 0, networkFeeNative: 0, realizedPnlNative: 0,
    realizedPnlUsd: 0, executedAt: 1
  }];
  await assert.rejects(coordinator.mutate({ type: 'IMPORT', payload: malformedTrade }), /invalidTrade/);

  const unsafeSettings = structuredClone(payload);
  unsafeSettings.settings.chains.eth.networkFeeNative = Infinity;
  await assert.rejects(coordinator.mutate({ type: 'IMPORT', payload: unsafeSettings }), /invalidSettings/);

  const invalidTimestamp = structuredClone(payload);
  invalidTimestamp.exportedAt = Infinity;
  await assert.rejects(coordinator.mutate({ type: 'IMPORT', payload: invalidTimestamp }), /importFailed/);
  assert.equal((await coordinator.getAll()).state.stateRevision, 1);
});

test('imports a structurally valid v1 backup and canonicalizes its Solana state', async () => {
  const initial = State.createInitialState({ now: 1 });
  const persistence = memoryPersistence(initial, State.normalizeSettings({}));
  const coordinator = StateCoordinator.create({
    readRaw: persistence.readRaw,
    writeRaw: persistence.writeRaw,
    now: () => 2_000
  });
  const payload = {
    product: 'Tango Paper Trader', version: '0.2.17', exportedAt: 1_500,
    settings: { buyPresets: [1], networkFeeSol: 0.001, initialBalanceSol: 10 },
    state: {
      schemaVersion: 1,
      account: { initialBalanceSol: 10, cashBalanceSol: 9, realizedPnlSol: 0, createdAt: 10, updatedAt: 20 },
      positions: {},
      trades: [],
      dailyRealized: {},
      initialized: true
    }
  };

  const imported = await coordinator.mutate({ type: 'IMPORT', payload });
  assert.equal(imported.state.schemaVersion, 2);
  assert.equal(imported.state.accounts.sol.cashBalanceNative, 9);
  assert.equal(imported.state.accounts.eth.createdAt, 1_500);
  assert.equal(imported.settings.chains.sol.buyPresets[0], 1);
});

test('reset validates a raw v1 snapshot before one atomic migration-and-reset write', async () => {
  const legacy = {
    schemaVersion: 1,
    account: {
      initialBalanceSol: 10,
      cashBalanceSol: 9,
      realizedPnlSol: -1,
      createdAt: 10,
      updatedAt: 20
    },
    positions: {},
    trades: [],
    dailyRealized: {},
    initialized: true
  };
  const settings = State.normalizeSettings({
    selectedChain: 'sol',
    chains: { eth: { initialBalanceNative: 20 }, bsc: { initialBalanceNative: 30 } }
  });
  const persistence = memoryPersistence(legacy, settings);
  const coordinator = StateCoordinator.create({
    readRaw: persistence.readRaw,
    writeRaw: persistence.writeRaw,
    now: () => 2_000
  });

  await assert.rejects(
    coordinator.mutate({ type: 'RESET_CHAIN', chain: 'eth', balanceNative: Infinity }),
    /invalidResetPrincipal/
  );
  assert.equal(persistence.writes.length, 0);
  assert.equal(persistence.values[global.Tango.STORAGE_KEY].schemaVersion, 1);

  const committed = await coordinator.mutate({ type: 'RESET_CHAIN', chain: 'eth', balanceNative: 42 });
  assert.equal(persistence.writes.length, 1);
  assert.deepEqual(Object.keys(persistence.writes[0]).sort(), [
    global.Tango.SETTINGS_KEY,
    global.Tango.STORAGE_KEY
  ].sort());
  assert.equal(committed.state.schemaVersion, 2);
  assert.equal(committed.state.stateRevision, 1);
  assert.equal(committed.state.accounts.eth.cashBalanceNative, 42);
  assert.equal(committed.settings.chains.eth.initialBalanceNative, 42);
});

test('persists one raw v1 migration while holding the coordinator queue', async () => {
  const legacy = {
    schemaVersion: 1,
    account: {
      initialBalanceSol: 10,
      cashBalanceSol: 9,
      realizedPnlSol: -1,
      createdAt: 10,
      updatedAt: 20
    },
    positions: {},
    trades: [],
    dailyRealized: {},
    initialized: true
  };
  const settings = State.normalizeSettings({});
  const persistence = memoryPersistence(legacy, settings);
  const coordinator = StateCoordinator.create({
    readRaw: persistence.readRaw,
    writeRaw: persistence.writeRaw,
    now: () => 2_000
  });

  const first = await coordinator.getAll();
  const second = await coordinator.getAll();
  assert.equal(persistence.values[global.Tango.STORAGE_KEY].schemaVersion, 2);
  assert.equal(first.state.accounts.eth.createdAt, 2_000);
  assert.deepEqual(second.state, first.state);
  assert.equal(first.state.stateRevision, 1);
});

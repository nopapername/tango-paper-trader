# Storage Byte Budget and Lossless Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep every persisted paper-trading state at or below an exact 8 MiB UTF-8 budget, preserve fallback provenance and the current mutation, reject oversized imports losslessly, and carry typed byte details from the coordinator to the Dashboard.

**Architecture:** Add pure byte measurement and deterministic history compaction beside the atomic coordinator, then route every state-writing coordinator branch through that policy. The service worker remains the single extension-storage writer; typed failures cross its message boundary without replacing the existing string error field, and the Dashboard renders an import-specific, byte-aware failure while leaving authoritative state unchanged.

**Tech Stack:** JavaScript, Chrome Extension Manifest V3 service worker and `storage.local`, Node.js built-in test runner, `node:assert/strict`, VM-based worker/page harnesses.

## Global Constraints

- The serialized state budget is exactly `8 * 1024 * 1024` UTF-8 bytes; the existing 10,000-entry limits remain logical upper bounds.
- Measure `JSON.stringify(state)` bytes, not JavaScript UTF-16 code units and not entry counts.
- Accounts, positions, daily realized values, settings-bearing state, and the current mutation are essential and cannot be silently dropped.
- A retained durable UNKNOWN_FALLBACK trade keeps its canonical chain/token history unit; removing its origin removes the complete dependent unit.
- Removal order is timestamp ascending, calibration before trade at equal timestamp, stable record ID ascending, then original array index ascending.
- Preserve original order among retained trades and calibrations and never mutate caller-owned arrays or objects.
- Normal writes may compact; `IMPORT` is lossless and must reject an oversized normalized state with `importTooLarge`.
- Irreducible runtime overflow and native quota exhaustion must reject atomically with `storageFull`; no write, retry with a different result, or revision advance is permitted.
- Errors expose `code`, `measuredBytes`, and `budgetBytes` through coordinator, background response, Store client, and Dashboard import handling.
- Do not add `unlimitedStorage` or any other permission.
- No production change may precede the focused failing test that specifies it.

---

## File Map

- Modify: `src/shared/constants.js` — define the exact 8 MiB budget.
- Modify: `src/core/state-coordinator.js` — pure measurement/compaction, protected-history detection, lossless import, all atomic state writes, and native quota normalization.
- Modify: `src/background.js` — serialize typed coordinator failure details.
- Modify: `src/core/storage.js` — reconstruct typed failures in extension pages.
- Modify: `src/shared/i18n.js` — bilingual oversized-import message.
- Modify: `src/dashboard/dashboard.js` — render measured and budget MiB without changing state.
- Modify: `tests/state-coordinator.test.js` — pure policy, dependency closure, atomic writes, import, migration, representative quota, and failure atomicity.
- Modify: `tests/background.test.js` — service-worker failure envelope.
- Modify: `tests/storage.test.js` — Store-side typed error reconstruction.
- Modify: `tests/dashboard-runtime.test.js` — byte-aware lossless-import failure UI.

### Task 1: Pure UTF-8 Measurement and Deterministic Dependency-Aware Compaction

**Files:**
- Modify: `src/shared/constants.js:8`
- Modify: `src/core/state-coordinator.js:1-4,370`
- Modify: `tests/state-coordinator.test.js`

**Interfaces:**
- Produces: `StateCoordinator.serializedStateBytes(state: object) -> number`.
- Produces: `StateCoordinator.compactStateForStorage(state, settings, options) -> { state, measuredBytes, budgetBytes, removedTradeIds, removedCalibrationIds }`.
- Options: `{ budgetBytes, protectedTradeIndexes, protectedCalibrationIndexes }`, where protected indexes refer to the normalized arrays' original positions.
- Throws: an `Error` with `code === 'storageFull'`, `measuredBytes`, and `budgetBytes` when essential state cannot fit.

- [ ] **Step 1: Add canonical history fixtures and failing pure-policy tests**

Add these helpers after `memoryPersistence` in `tests/state-coordinator.test.js`:

```js
const stateBytes = (state) => Buffer.byteLength(JSON.stringify(state), 'utf8');
const EVM_HISTORY_ADDRESS = '0xa111111111111111111111111111111111111111';
const EVM_OPEN_ADDRESS = '0xb222222222222222222222222222222222222222';

function storageStateFixture() {
  const state = State.createInitialState({ now: 1 });
  state.initialized = true;
  return state;
}

function storageTradeFixture({
  id,
  executedAt,
  tokenAddress = EVM_HISTORY_ADDRESS,
  side = 'BUY',
  sourceUrl = ''
}) {
  return {
    id,
    chain: 'eth',
    tokenAddress,
    symbol: 'SAFE',
    name: 'Safe',
    logoUrl: '',
    side,
    quantity: 1,
    amountNative: side === 'BUY' ? 1 : 0,
    observedPriceUsd: 2,
    executionPriceUsd: 2,
    marketCapUsd: 0,
    liquidityUsd: 0,
    nativePriceUsd: 2_000,
    nativeSymbol: 'ETH',
    slippageBps: 0,
    platformFeeNative: 0,
    networkFeeNative: 0,
    realizedPnlNative: 0,
    realizedPnlUsd: 0,
    valuationMode: 'PRICE',
    priceProvenance: 'OBSERVED_PRICE',
    quoteSource: 'GMGN_NETWORK',
    sourceUrl,
    executedAt
  };
}

function storageCalibrationFixture({ id, createdAt, tokenAddress = EVM_HISTORY_ADDRESS }) {
  return {
    id,
    chain: 'eth',
    tokenAddress,
    reason: 'PRICE',
    fromPriceUsd: 1,
    toPriceUsd: 2,
    fromNativePriceUsd: 2_000,
    toNativePriceUsd: 2_000,
    fromSupply: 0,
    toSupply: 0,
    quantityBefore: 1,
    quantityAfter: 1,
    costBasisNative: 1,
    createdAt
  };
}

function fallbackTradeFixture({ id, tokenAddress, side, executedAt }) {
  return {
    ...storageTradeFixture({ id, tokenAddress, side, executedAt }),
    observedPriceUsd: 0.0000032,
    executionPriceUsd: 0.0000032,
    marketCapUsd: 3_200,
    valuationMode: 'MARKET_CAP',
    priceProvenance: 'SYNTHETIC_PRICE',
    quoteSource: 'TANGO_FALLBACK',
    paperFallback: true,
    provisional: true,
    syntheticTokenPrice: true,
    syntheticNativePrice: false,
    totalSupply: 1_000_000_000,
    marketCapDivisor: 1_000_000_000,
    provisionalSupply: 1_000_000_000,
    provisionalSupplyProvenance: 'TANGO_INTERNAL_UNKNOWN_FALLBACK_V1',
    supplySource: 'UNKNOWN_FALLBACK',
    launchpad: '',
    launchMode: ''
  };
}

function openFallbackPosition(tokenAddress, openedAt, updatedAt) {
  return {
    chain: 'eth',
    tokenAddress,
    symbol: 'OPEN',
    name: 'Open',
    logoUrl: '',
    quantity: 1,
    costBasisNative: 1,
    averageEntryPriceUsd: 0.0000032,
    averageEntryMarketCap: 3_200,
    realizedPnlNative: 0,
    lastPriceUsd: 0.0000032,
    lastMarketCapUsd: 3_200,
    lastNativePriceUsd: 2_000,
    openedAt,
    quoteObservedAt: updatedAt,
    updatedAt,
    valuationMode: 'MARKET_CAP',
    marketCapDivisor: 1_000_000_000,
    lastPriceProvenance: 'SYNTHETIC_PRICE',
    averageEntryPriceProvenance: 'SYNTHETIC_PRICE',
    paperFallback: true,
    provisional: true,
    syntheticTokenPrice: true,
    syntheticNativePrice: false,
    totalSupply: 1_000_000_000,
    provisionalSupply: 1_000_000_000,
    provisionalSupplyProvenance: 'TANGO_INTERNAL_UNKNOWN_FALLBACK_V1',
    supplySource: 'UNKNOWN_FALLBACK',
    launchpad: '',
    launchMode: '',
    needsCalibration: true,
    provisionalTokenPrice: true,
    provisionalNativePrice: false,
    quoteSource: 'TANGO_FALLBACK'
  };
}
```

Append these tests:

```js
test('storage compaction measures UTF-8 and uses the stable calibration-first removal key', () => {
  const settings = State.normalizeSettings({});
  const state = storageStateFixture();
  state.accounts.eth.memo = '账户🔥';
  state.trades = [
    storageTradeFixture({ id: 'a-trade', executedAt: 1_000 }),
    storageTradeFixture({ id: 'trade-new', executedAt: 2_000 })
  ];
  state.calibrations = [
    storageCalibrationFixture({ id: 'z-cal', createdAt: 1_000 }),
    storageCalibrationFixture({ id: 'b-cal', createdAt: 1_000 }),
    storageCalibrationFixture({
      id: 'z-cal',
      createdAt: 1_000,
      tokenAddress: EVM_OPEN_ADDRESS
    })
  ];
  const normalized = State.normalizeState(state, settings);
  const expected = {
    ...normalized,
    calibrations: [normalized.calibrations[2]]
  };
  const before = structuredClone(state);

  const result = StateCoordinator.compactStateForStorage(state, settings, {
    budgetBytes: stateBytes(expected)
  });

  assert.equal(StateCoordinator.serializedStateBytes(state), stateBytes(state));
  assert.equal(result.measuredBytes, stateBytes(expected));
  assert.deepEqual(result.state, expected);
  assert.deepEqual(result.removedCalibrationIds, ['b-cal', 'z-cal']);
  assert.equal(result.state.calibrations[0].tokenAddress, EVM_OPEN_ADDRESS);
  assert.deepEqual(result.removedTradeIds, []);
  assert.deepEqual(state, before);
});

test('storage compaction removes a closed fallback unit atomically and retains an open unit closure', () => {
  const settings = State.normalizeSettings({});
  const state = storageStateFixture();
  state.trades = [
    fallbackTradeFixture({ id: 'open-dependent', tokenAddress: EVM_OPEN_ADDRESS, side: 'SELL', executedAt: 250 }),
    fallbackTradeFixture({ id: 'open-origin', tokenAddress: EVM_OPEN_ADDRESS, side: 'BUY', executedAt: 200 }),
    fallbackTradeFixture({ id: 'closed-dependent', tokenAddress: EVM_HISTORY_ADDRESS, side: 'SELL', executedAt: 150 }),
    fallbackTradeFixture({ id: 'closed-origin', tokenAddress: EVM_HISTORY_ADDRESS, side: 'BUY', executedAt: 100 })
  ];
  state.positions[`eth:${EVM_OPEN_ADDRESS}`] = openFallbackPosition(EVM_OPEN_ADDRESS, 200, 250);
  assert.doesNotThrow(() => State.normalizeState(state, settings, { strict: true }));
  const expected = State.normalizeState({
    ...state,
    trades: state.trades.filter(({ tokenAddress }) => tokenAddress === EVM_OPEN_ADDRESS)
  }, settings, { strict: true });

  const result = StateCoordinator.compactStateForStorage(state, settings, {
    budgetBytes: stateBytes(expected)
  });

  assert.deepEqual(result.removedTradeIds, ['closed-origin', 'closed-dependent']);
  assert.deepEqual(result.state.trades.map(({ id }) => id), ['open-dependent', 'open-origin']);
  assert.doesNotThrow(() => State.normalizeState(
    structuredClone(result.state), settings, { strict: true }
  ));
});
```

- [ ] **Step 2: Run the two pure tests and verify RED**

Run:

```powershell
node --test --test-name-pattern="storage compaction" tests/state-coordinator.test.js
```

Expected: both tests fail because `StateCoordinator.compactStateForStorage` and `serializedStateBytes` do not exist. The failure must occur at the missing production interface rather than in fixture validation.

- [ ] **Step 3: Add the exact budget constant**

Add immediately after `Tango.MAX_TRADES` in `src/shared/constants.js`:

```js
  Tango.STATE_STORAGE_BUDGET_BYTES = 8 * 1024 * 1024;
```

- [ ] **Step 4: Add pure measurement, ordering, dependency units, and typed failure helpers**

Insert this block after `TRUSTED_METADATA_SOURCES` in `src/core/state-coordinator.js`:

```js
  const UNKNOWN_FALLBACK_SOURCE = 'UNKNOWN_FALLBACK';
  const UNKNOWN_FALLBACK_PROVENANCE = 'TANGO_INTERNAL_UNKNOWN_FALLBACK_V1';

  function utf8TextBytes(value) {
    const text = String(value);
    let bytes = 0;
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      if (code <= 0x7f) {
        bytes += 1;
      } else if (code <= 0x7ff) {
        bytes += 2;
      } else if (code >= 0xd800 && code <= 0xdbff
        && index + 1 < text.length
        && text.charCodeAt(index + 1) >= 0xdc00
        && text.charCodeAt(index + 1) <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    }
    return bytes;
  }

  function serializedStateBytes(state) {
    return utf8TextBytes(JSON.stringify(state));
  }

  function storageBudgetError(code, measuredBytes, budgetBytes, cause) {
    const error = new Error(code);
    error.name = 'TangoStorageBudgetError';
    error.code = code;
    error.measuredBytes = Number(measuredBytes);
    error.budgetBytes = Number(budgetBytes);
    if (cause !== undefined) error.cause = cause;
    return error;
  }

  function historyRecordKey(collection, record, originalIndex) {
    const timestamp = Number(collection === 'calibration' ? record.createdAt : record.executedAt);
    return {
      timestamp: Number.isSafeInteger(timestamp) && timestamp >= 0
        ? timestamp
        : Number.MAX_SAFE_INTEGER,
      priority: collection === 'calibration' ? 0 : 1,
      id: String(record.id || ''),
      originalIndex
    };
  }

  function compareHistoryKeys(left, right) {
    if (left.timestamp !== right.timestamp) return left.timestamp - right.timestamp;
    if (left.priority !== right.priority) return left.priority - right.priority;
    if (left.id !== right.id) return left.id < right.id ? -1 : 1;
    return left.originalIndex - right.originalIndex;
  }

  function durableFallbackKey(trade) {
    return trade?.supplySource === UNKNOWN_FALLBACK_SOURCE
      && trade?.provisionalSupplyProvenance === UNKNOWN_FALLBACK_PROVENANCE
      ? `${trade.chain}:${trade.tokenAddress}`
      : '';
  }

  function arrayContentsBytes(entries) {
    if (!entries.length) return 0;
    return entries.reduce((sum, entry) => sum + entry.bytes, 0) + entries.length - 1;
  }

  function compactStateForStorage(state, settings, options = {}) {
    const budgetBytes = Number(options.budgetBytes ?? Tango.STATE_STORAGE_BUDGET_BYTES);
    if (!Number.isSafeInteger(budgetBytes) || budgetBytes <= 0) {
      throw new Error('invalidStorageBudget');
    }
    const normalized = Tango.State.normalizeState(state, settings);
    const protectedTradeIndexes = new Set(options.protectedTradeIndexes || []);
    const protectedCalibrationIndexes = new Set(options.protectedCalibrationIndexes || []);
    const openFallbackKeys = new Set(Object.values(normalized.positions || {})
      .filter((position) => position?.supplySource === UNKNOWN_FALLBACK_SOURCE)
      .map((position) => `${position.chain}:${position.tokenAddress}`));
    const removedTradeIndexes = new Set();
    const removedCalibrationIndexes = new Set();
    const removedTradeIds = [];
    const removedCalibrationIds = [];
    const fallbackUnits = new Map();
    const units = [];

    const tradeEntries = normalized.trades.map((record, originalIndex) => ({
      collection: 'trade',
      record,
      originalIndex,
      key: historyRecordKey('trade', record, originalIndex),
      bytes: utf8TextBytes(JSON.stringify(record))
    }));
    const calibrationEntries = normalized.calibrations.map((record, originalIndex) => ({
      collection: 'calibration',
      record,
      originalIndex,
      key: historyRecordKey('calibration', record, originalIndex),
      bytes: utf8TextBytes(JSON.stringify(record))
    }));

    for (const entry of tradeEntries) {
      const dependencyKey = durableFallbackKey(entry.record);
      if (!dependencyKey) {
        units.push({ entries: [entry], protected: protectedTradeIndexes.has(entry.originalIndex) });
        continue;
      }
      const unit = fallbackUnits.get(dependencyKey) || {
        entries: [],
        protected: openFallbackKeys.has(dependencyKey)
      };
      unit.entries.push(entry);
      unit.protected = unit.protected || protectedTradeIndexes.has(entry.originalIndex);
      fallbackUnits.set(dependencyKey, unit);
    }
    units.push(...fallbackUnits.values());
    units.push(...calibrationEntries.map((entry) => ({
      entries: [entry],
      protected: protectedCalibrationIndexes.has(entry.originalIndex)
    })));
    for (const unit of units) {
      unit.entries.sort((left, right) => compareHistoryKeys(left.key, right.key));
      unit.key = unit.entries[0].key;
    }
    const candidates = units
      .filter((unit) => !unit.protected)
      .sort((left, right) => compareHistoryKeys(left.key, right.key));

    const baseState = { ...normalized, trades: [], calibrations: [] };
    let measuredBytes = serializedStateBytes(baseState)
      + arrayContentsBytes(tradeEntries)
      + arrayContentsBytes(calibrationEntries);
    let remainingTrades = tradeEntries.length;
    let remainingCalibrations = calibrationEntries.length;

    for (const unit of candidates) {
      if (measuredBytes <= budgetBytes) break;
      const trades = unit.entries.filter(({ collection }) => collection === 'trade');
      const calibrations = unit.entries.filter(({ collection }) => collection === 'calibration');
      if (trades.length) {
        const after = remainingTrades - trades.length;
        measuredBytes -= trades.reduce((sum, entry) => sum + entry.bytes, 0)
          + Math.max(remainingTrades - 1, 0) - Math.max(after - 1, 0);
        remainingTrades = after;
        for (const entry of trades) {
          removedTradeIndexes.add(entry.originalIndex);
          removedTradeIds.push(String(entry.record.id));
        }
      }
      if (calibrations.length) {
        const after = remainingCalibrations - calibrations.length;
        measuredBytes -= calibrations.reduce((sum, entry) => sum + entry.bytes, 0)
          + Math.max(remainingCalibrations - 1, 0) - Math.max(after - 1, 0);
        remainingCalibrations = after;
        for (const entry of calibrations) {
          removedCalibrationIndexes.add(entry.originalIndex);
          removedCalibrationIds.push(String(entry.record.id));
        }
      }
    }

    const compacted = {
      ...normalized,
      trades: normalized.trades.filter((_, index) => !removedTradeIndexes.has(index)),
      calibrations: normalized.calibrations.filter((_, index) => !removedCalibrationIndexes.has(index))
    };
    measuredBytes = serializedStateBytes(compacted);
    if (measuredBytes > budgetBytes) {
      throw storageBudgetError('storageFull', measuredBytes, budgetBytes);
    }
    Tango.State.normalizeState(compacted, settings, { strict: true });
    return {
      state: compacted,
      measuredBytes,
      budgetBytes,
      removedTradeIds,
      removedCalibrationIds
    };
  }
```

This implementation calculates array-element and comma savings incrementally, then performs one final full serialization check. It therefore remains linear for the representative 20,000-record state.

- [ ] **Step 5: Export the pure interfaces without changing `create`**

Replace the final assignment in `src/core/state-coordinator.js` with:

```js
  Tango.StateCoordinator = { create, serializedStateBytes, compactStateForStorage };
  if (typeof module !== 'undefined' && module.exports) module.exports = Tango.StateCoordinator;
```

- [ ] **Step 6: Run the focused tests and verify GREEN**

Run:

```powershell
node --test --test-name-pattern="storage compaction" tests/state-coordinator.test.js
```

Expected: both tests pass; the first proves UTF-8 byte parity with Node's independent `Buffer` oracle and the second proves closed-history unit removal plus strict re-import validity.

- [ ] **Step 7: Run the complete coordinator suite**

Run:

```powershell
node --test tests/state-coordinator.test.js
```

Expected: all coordinator tests pass.

- [ ] **Step 8: Commit the pure policy**

```powershell
git add src/shared/constants.js src/core/state-coordinator.js tests/state-coordinator.test.js
git commit -m "feat: compact paper history by serialized byte budget"
```

### Task 2: Enforce the Budget on Every Atomic State Write and Keep Import Lossless

**Files:**
- Modify: `src/core/state-coordinator.js:152-367`
- Modify: `tests/state-coordinator.test.js`

**Interfaces:**
- Extends: `StateCoordinator.create({ readRaw, writeRaw, now, stateBudgetBytes })` with a test-injectable positive integer budget; production defaults to `Tango.STATE_STORAGE_BUDGET_BYTES`.
- Produces: `commitState(previous, next, settings, protection) -> Promise<compactedState>`.
- Produces: `historyProtection(previous, next) -> { protectedTradeIndexes, protectedCalibrationIndexes }` using stable record-ID occurrence counts.
- `IMPORT` throws `importTooLarge` before `writeRaw`; every other state write returns exactly the state it persisted.

- [ ] **Step 1: Add failing atomic BUY, import, essential-overflow, migration, reset, and representative quota tests**

Append the following tests to `tests/state-coordinator.test.js`:

```js
test('a near-budget BUY retains the current trade, advances once, and drops only oldest history', async () => {
  const state = storageStateFixture();
  state.stateRevision = 4;
  state.trades = [
    storageTradeFixture({ id: 'newer-history', executedAt: 2_000 }),
    storageTradeFixture({
      id: 'oldest-large-trade',
      executedAt: 1_000,
      sourceUrl: `https://gmgn.ai/${'x'.repeat(4_096)}`
    })
  ];
  const settings = State.normalizeSettings({
    slippageBps: 0,
    platformFeeBps: 0,
    chains: { eth: { networkFeeNative: 0 } }
  });
  const persistence = memoryPersistence(state, settings);
  const coordinator = StateCoordinator.create({
    readRaw: persistence.readRaw,
    writeRaw: persistence.writeRaw,
    now: () => 3_000,
    stateBudgetBytes: stateBytes(state) - 1
  });
  const order = {
    token: {
      chain: 'eth',
      address: '0xc333333333333333333333333333333333333333',
      symbol: 'CURRENT'
    },
    quote: {
      priceUsd: 2,
      nativePriceUsd: 2_000,
      observedAt: 3_000,
      nativePriceObservedAt: 3_000,
      source: 'GMGN_NETWORK',
      valuationMode: 'PRICE',
      priceProvenance: 'OBSERVED_PRICE'
    },
    amountNative: 1
  };

  const result = await coordinator.mutate({ type: 'EXECUTE_BUY', order });

  assert.equal(result.state.stateRevision, 5);
  assert.equal(result.state.trades.some(({ id }) => id === result.trade.id), true);
  assert.equal(result.state.trades.some(({ id }) => id === 'newer-history'), true);
  assert.equal(result.state.trades.some(({ id }) => id === 'oldest-large-trade'), false);
  assert.ok(stateBytes(result.state) <= stateBytes(state) - 1);
  assert.deepEqual(persistence.values[global.Tango.STORAGE_KEY], result.state);
  assert.equal(persistence.writes.length, 1);
});

test('oversized IMPORT reports exact bytes and leaves current state and settings unchanged', async () => {
  const current = storageStateFixture();
  const settings = State.normalizeSettings({ selectedChain: 'eth' });
  const imported = storageStateFixture();
  imported.padding = '🔥'.repeat(256);
  const payload = {
    product: 'Tango Paper Trader',
    version: 'test',
    exportedAt: 1_500,
    state: imported,
    settings
  };
  const measuredState = State.normalizeState(imported, settings, { strict: true });
  measuredState.initialized = true;
  measuredState.stateRevision = 1;
  const measuredBytes = stateBytes(measuredState);
  const persistence = memoryPersistence(current, settings);
  const coordinator = StateCoordinator.create({
    readRaw: persistence.readRaw,
    writeRaw: persistence.writeRaw,
    now: () => 2_000,
    stateBudgetBytes: measuredBytes - 1
  });

  await assert.rejects(
    coordinator.mutate({ type: 'IMPORT', payload }),
    (error) => {
      assert.equal(error.code, 'importTooLarge');
      assert.equal(error.measuredBytes, measuredBytes);
      assert.equal(error.budgetBytes, measuredBytes - 1);
      return true;
    }
  );
  assert.equal(persistence.writes.length, 0);
  assert.deepEqual(persistence.values[global.Tango.STORAGE_KEY], current);
  assert.deepEqual(persistence.values[global.Tango.SETTINGS_KEY], settings);
});

test('essential-state overflow returns storageFull without a write or revision advance', async () => {
  const current = storageStateFixture();
  current.stateRevision = 7;
  const settings = State.normalizeSettings({});
  const replacement = storageStateFixture();
  replacement.stateRevision = 7;
  replacement.padding = '🔥'.repeat(512);
  const persistence = memoryPersistence(current, settings);
  const budgetBytes = stateBytes(current) + 1;
  const coordinator = StateCoordinator.create({
    readRaw: persistence.readRaw,
    writeRaw: persistence.writeRaw,
    stateBudgetBytes: budgetBytes
  });

  await assert.rejects(
    coordinator.mutate({
      type: 'REPLACE_STATE',
      state: replacement,
      expectedRevision: 7
    }),
    (error) => {
      assert.equal(error.code, 'storageFull');
      assert.ok(error.measuredBytes > budgetBytes);
      assert.equal(error.budgetBytes, budgetBytes);
      return true;
    }
  );
  assert.equal(persistence.writes.length, 0);
  assert.deepEqual(persistence.values[global.Tango.STORAGE_KEY], current);
});

for (const [name, command] of [
  ['INITIALIZE', { type: 'INITIALIZE', language: 'en', defaultBalanceNative: 10 }],
  ['RESET_ALL_WITH_BALANCE', { type: 'RESET_ALL_WITH_BALANCE', balanceNative: 10 }]
]) {
  test(`${name} applies the byte policy before its direct atomic write`, async () => {
    const current = storageStateFixture();
    current.stateRevision = 9;
    const settings = State.normalizeSettings({});
    const persistence = memoryPersistence(current, settings);
    const coordinator = StateCoordinator.create({
      readRaw: persistence.readRaw,
      writeRaw: persistence.writeRaw,
      now: () => 2_000,
      stateBudgetBytes: 1
    });

    await assert.rejects(
      coordinator.mutate(command),
      (error) => {
        assert.equal(error.code, 'storageFull');
        assert.ok(error.measuredBytes > 1);
        assert.equal(error.budgetBytes, 1);
        return true;
      }
    );
    assert.equal(persistence.writes.length, 0);
    assert.deepEqual(persistence.values[global.Tango.STORAGE_KEY], current);
    assert.deepEqual(persistence.values[global.Tango.SETTINGS_KEY], settings);
  });
}

test('raw v1 migration compacts before its one atomic migration write', async () => {
  const address = 'So11111111111111111111111111111111111111112';
  const legacy = {
    schemaVersion: 1,
    stateRevision: 0,
    account: {
      initialBalanceSol: 10,
      cashBalanceSol: 10,
      realizedPnlSol: 0,
      createdAt: 1,
      updatedAt: 1
    },
    positions: {},
    trades: [{
      id: 'legacy-large',
      chain: 'sol',
      tokenAddress: address,
      symbol: 'LEGACY',
      side: 'BUY',
      quantity: 1,
      amountSol: 1,
      observedPriceUsd: 2,
      executionPriceUsd: 2,
      marketCapUsd: 0,
      liquidityUsd: 0,
      solPriceUsd: 100,
      slippageBps: 0,
      platformFeeSol: 0,
      networkFeeSol: 0,
      realizedPnlSol: 0,
      sourceUrl: `https://gmgn.ai/${'x'.repeat(2_048)}`,
      executedAt: 1
    }],
    dailyRealized: {},
    initialized: true
  };
  const settings = State.normalizeSettings({});
  const expected = State.normalizeState(legacy, settings, { migrationNow: 2_000 });
  expected.stateRevision = 1;
  expected.trades = [];
  const persistence = memoryPersistence(legacy, settings);
  const coordinator = StateCoordinator.create({
    readRaw: persistence.readRaw,
    writeRaw: persistence.writeRaw,
    now: () => 2_000,
    stateBudgetBytes: stateBytes(expected)
  });

  const migrated = await coordinator.getAll();

  assert.deepEqual(migrated.state, expected);
  assert.deepEqual(persistence.values[global.Tango.STORAGE_KEY], expected);
  assert.equal(persistence.writes.length, 1);
});

test('RESET_CHAIN compacts retained history from other chains before its atomic state-and-settings write', async () => {
  const state = storageStateFixture();
  state.trades = [
    { ...storageTradeFixture({ id: 'bsc-old', executedAt: 1_000, sourceUrl: 'x'.repeat(2_048) }),
      chain: 'bsc', tokenAddress: '0xd444444444444444444444444444444444444444', nativeSymbol: 'BNB' },
    storageTradeFixture({ id: 'eth-reset-away', executedAt: 2_000 })
  ];
  const settings = State.normalizeSettings({});
  const expectedEssential = State.resetChain(state, 'eth', 42, 3_000);
  expectedEssential.trades = [];
  expectedEssential.stateRevision = state.stateRevision + 1;
  const persistence = memoryPersistence(state, settings);
  const coordinator = StateCoordinator.create({
    readRaw: persistence.readRaw,
    writeRaw: persistence.writeRaw,
    now: () => 3_000,
    stateBudgetBytes: stateBytes(expectedEssential)
  });

  const result = await coordinator.mutate({ type: 'RESET_CHAIN', chain: 'eth', balanceNative: 42 });

  assert.deepEqual(result.state, expectedEssential);
  assert.equal(result.settings.chains.eth.initialBalanceNative, 42);
  assert.deepEqual(persistence.values[global.Tango.STORAGE_KEY], result.state);
  assert.deepEqual(persistence.values[global.Tango.SETTINGS_KEY], result.settings);
  assert.equal(persistence.writes.length, 1);
});

test('representative 10k trade plus 10k calibration state commits below 8 MiB under a 10 MiB quota', async () => {
  const state = storageStateFixture();
  state.trades = Array.from({ length: 10_000 }, (_, index) => storageTradeFixture({
    id: `trade-${String(index).padStart(5, '0')}`,
    executedAt: index + 1,
    sourceUrl: `https://gmgn.ai/${'x'.repeat(700)}`
  }));
  state.calibrations = Array.from({ length: 10_000 }, (_, index) => storageCalibrationFixture({
    id: `cal-${String(index).padStart(5, '0')}`,
    createdAt: index + 1
  }));
  const settings = State.normalizeSettings({
    slippageBps: 0,
    platformFeeBps: 0,
    chains: { eth: { networkFeeNative: 0 } }
  });
  const values = {
    [global.Tango.STORAGE_KEY]: structuredClone(state),
    [global.Tango.SETTINGS_KEY]: structuredClone(settings)
  };
  const writes = [];
  const quotaBytes = 10 * 1024 * 1024;
  const readRaw = async (keys) => Object.fromEntries(
    keys.filter((key) => key in values).map((key) => [key, structuredClone(values[key])])
  );
  const writeRaw = async (next) => {
    const merged = { ...values, ...structuredClone(next) };
    if (Buffer.byteLength(JSON.stringify(merged), 'utf8') > quotaBytes) {
      const error = new Error('QUOTA_BYTES quota exceeded');
      error.name = 'QuotaExceededError';
      throw error;
    }
    writes.push(structuredClone(next));
    Object.assign(values, structuredClone(next));
  };
  assert.ok(stateBytes(state) > quotaBytes);
  await assert.rejects(writeRaw({ [global.Tango.STORAGE_KEY]: state }), /QUOTA_BYTES/);
  const coordinator = StateCoordinator.create({ readRaw, writeRaw, now: () => 20_000 });

  const result = await coordinator.mutate({
    type: 'EXECUTE_BUY',
    order: {
      token: {
        chain: 'eth',
        address: '0xe555555555555555555555555555555555555555',
        symbol: 'CURRENT'
      },
      quote: {
        priceUsd: 2,
        nativePriceUsd: 2_000,
        observedAt: 20_000,
        nativePriceObservedAt: 20_000,
        source: 'GMGN_NETWORK',
        valuationMode: 'PRICE',
        priceProvenance: 'OBSERVED_PRICE'
      },
      amountNative: 1
    }
  });

  assert.ok(stateBytes(result.state) <= 8 * 1024 * 1024);
  assert.equal(result.state.trades.some(({ id }) => id === result.trade.id), true);
  assert.deepEqual(values[global.Tango.STORAGE_KEY], result.state);
  assert.equal(writes.length, 1);
});
```

- [ ] **Step 2: Run the focused atomic tests and verify RED**

Run:

```powershell
node --test --test-name-pattern="near-budget BUY|oversized IMPORT|essential-state overflow|applies the byte policy|raw v1 migration compacts|RESET_CHAIN compacts|representative 10k" tests/state-coordinator.test.js
```

Expected failures:

- `create` ignores `stateBudgetBytes`, so near-budget and migration/reset writes remain oversized.
- oversized import writes instead of throwing `importTooLarge`.
- essential replacement writes instead of throwing `storageFull`.
- initialization and reset-with-balance bypass the injected byte policy and write.
- the representative fake rejects the un-compacted coordinator write with `QUOTA_BYTES quota exceeded`.

- [ ] **Step 3: Add budget injection and stable current-history detection**

Change the `create` signature and add these helpers at the start of `create` in `src/core/state-coordinator.js`:

```js
  function create({
    readRaw,
    writeRaw,
    now = () => Date.now(),
    stateBudgetBytes = Tango.STATE_STORAGE_BUDGET_BYTES
  } = {}) {
    if (typeof readRaw !== 'function' || typeof writeRaw !== 'function') {
      throw new Error('invalidCoordinatorStorage');
    }
    if (!Number.isSafeInteger(Number(stateBudgetBytes)) || Number(stateBudgetBytes) <= 0) {
      throw new Error('invalidStorageBudget');
    }
    stateBudgetBytes = Number(stateBudgetBytes);

    function addedRecordIndexes(previous = [], next = []) {
      const remaining = new Map();
      for (const record of previous) {
        const id = String(record?.id || '');
        remaining.set(id, (remaining.get(id) || 0) + 1);
      }
      const indexes = [];
      next.forEach((record, index) => {
        const id = String(record?.id || '');
        const count = remaining.get(id) || 0;
        if (count > 0) remaining.set(id, count - 1);
        else indexes.push(index);
      });
      return indexes;
    }

    function historyProtection(previous, next) {
      return {
        protectedTradeIndexes: addedRecordIndexes(previous?.trades, next?.trades),
        protectedCalibrationIndexes: addedRecordIndexes(previous?.calibrations, next?.calibrations)
      };
    }

    function prepareState(state, settings, protection = {}) {
      return compactStateForStorage(state, settings, {
        budgetBytes: stateBudgetBytes,
        ...protection
      });
    }
```

Retain the existing serialized queue immediately after these helpers.

- [ ] **Step 4: Route migration and generic commits through `prepareState`**

Replace `readSnapshot` and `commitState` with:

```js
    async function readSnapshot({ persistMigration = true } = {}) {
      const raw = await readRaw([Tango.STORAGE_KEY, Tango.SETTINGS_KEY]);
      const settings = Tango.State.normalizeSettings(raw[Tango.SETTINGS_KEY]);
      const storedState = raw[Tango.STORAGE_KEY];
      let state = Tango.State.normalizeState(storedState, settings, { migrationNow: now() });
      if (persistMigration && Number(storedState?.schemaVersion) === 1) {
        state.stateRevision = Number(storedState.stateRevision || 0) + 1;
        state = prepareState(state, settings).state;
        await writeRaw({
          [Tango.STORAGE_KEY]: state,
          [Tango.SETTINGS_KEY]: settings
        });
      }
      return { state, settings };
    }

    async function commitState(previous, next, settings) {
      const revised = {
        ...next,
        stateRevision: Number(previous.stateRevision || 0) + 1
      };
      const prepared = prepareState(revised, settings, historyProtection(previous, revised));
      await writeRaw({ [Tango.STORAGE_KEY]: prepared.state });
      return prepared.state;
    }
```

At the common mutation tail, replace the old commit call with:

```js
        if (result.state === state) return result;
        const committed = await commitState(state, result.state, settings);
        return { ...result, state: committed };
```

- [ ] **Step 5: Apply the same policy to initialization, lossless import, reset-with-balance, and reset-chain**

In `INITIALIZE`, replace the direct state assignment/write with:

```js
          const initialized = Tango.State.createInitialState({ now: now(), initialBalances });
          initialized.initialized = true;
          initialized.stateRevision = Number(state.stateRevision || 0) + 1;
          const prepared = prepareState(initialized, nextSettings);
          await writeRaw({
            [Tango.STORAGE_KEY]: prepared.state,
            [Tango.SETTINGS_KEY]: nextSettings
          });
          return { state: prepared.state, settings: nextSettings };
```

In `IMPORT`, replace the revision/write block with this lossless check:

```js
          importedState.initialized = true;
          importedState.stateRevision = Number(state.stateRevision || 0) + 1;
          const measuredBytes = serializedStateBytes(importedState);
          if (measuredBytes > stateBudgetBytes) {
            throw storageBudgetError(
              'importTooLarge', measuredBytes, stateBudgetBytes
            );
          }
          await writeRaw({
            [Tango.STORAGE_KEY]: importedState,
            [Tango.SETTINGS_KEY]: importedSettings
          });
          return { state: importedState, settings: importedSettings };
```

In `RESET_ALL_WITH_BALANCE`, replace the revision/write block with:

```js
          const nextState = Tango.State.resetAll(nextSettings, now());
          nextState.stateRevision = Number(state.stateRevision || 0) + 1;
          const prepared = prepareState(nextState, nextSettings);
          await writeRaw({
            [Tango.STORAGE_KEY]: prepared.state,
            [Tango.SETTINGS_KEY]: nextSettings
          });
          return { state: prepared.state, settings: nextSettings };
```

In `RESET_CHAIN`, replace the direct state/settings write with:

```js
          const nextState = Tango.State.resetChain(state, chain.id, balanceNative, now());
          nextState.stateRevision = Number(state.stateRevision || 0) + 1;
          const nextSettings = Tango.State.normalizeSettings({
            ...settings,
            chains: {
              ...settings.chains,
              [chain.id]: { ...settings.chains[chain.id], initialBalanceNative: balanceNative }
            }
          });
          const prepared = prepareState(nextState, nextSettings);
          await writeRaw({
            [Tango.STORAGE_KEY]: prepared.state,
            [Tango.SETTINGS_KEY]: nextSettings
          });
          return { state: prepared.state, settings: nextSettings };
```

`RESET_ALL` already flows through the common `commitState`. `SAVE_SETTINGS` and `PATCH_SETTINGS` do not write state and remain unchanged until native quota normalization in Task 3.

- [ ] **Step 6: Run the focused tests and verify GREEN**

Run:

```powershell
node --test --test-name-pattern="near-budget BUY|oversized IMPORT|essential-state overflow|applies the byte policy|raw v1 migration compacts|RESET_CHAIN compacts|representative 10k" tests/state-coordinator.test.js
```

Expected: all focused tests pass. The 20,000-record test completes without a quadratic timeout, persists one state no larger than 8 MiB, and keeps the new BUY.

- [ ] **Step 7: Run coordinator, State, Engine, and Store regressions**

Run:

```powershell
node --test tests/state-coordinator.test.js tests/state.test.js tests/engine.test.js tests/storage.test.js
```

Expected: all tests pass; existing initialization, both reset modes, close-all, calibration, revision conflict, and import validation remain intact.

- [ ] **Step 8: Commit all atomic-write enforcement**

```powershell
git add src/core/state-coordinator.js tests/state-coordinator.test.js
git commit -m "fix: enforce atomic storage budget on state writes"
```

### Task 3: Normalize Native Quota Failures and Preserve Details Across the Worker Boundary

**Files:**
- Modify: `src/core/state-coordinator.js`
- Modify: `src/background.js:49-60`
- Modify: `src/core/storage.js:23-26`
- Modify: `tests/state-coordinator.test.js`
- Modify: `tests/background.test.js`
- Modify: `tests/storage.test.js`

**Interfaces:**
- Produces: coordinator errors with `code`, `measuredBytes`, and `budgetBytes` for budget and native quota failures.
- Produces: worker response `{ ok: false, error: string, errorDetails?: { code, measuredBytes, budgetBytes } }`.
- Produces: Store-thrown `Error` with the typed fields restored while preserving the existing `error` string wire contract.

- [ ] **Step 1: Add a failing coordinator native-quota atomicity test**

Append to `tests/state-coordinator.test.js`:

```js
test('native quota failure becomes one storageFull failure without retry or state change', async () => {
  const state = storageStateFixture();
  state.stateRevision = 3;
  const settings = State.normalizeSettings({});
  const persistence = memoryPersistence(state, settings);
  let attempts = 0;
  const writeRaw = async () => {
    attempts += 1;
    const error = new Error('QUOTA_BYTES quota exceeded');
    error.name = 'QuotaExceededError';
    throw error;
  };
  const coordinator = StateCoordinator.create({
    readRaw: persistence.readRaw,
    writeRaw,
    now: () => 2_000
  });
  const expected = State.resetAll(settings, 2_000);
  expected.stateRevision = 4;

  await assert.rejects(
    coordinator.mutate({ type: 'RESET_ALL' }),
    (error) => {
      assert.equal(error.code, 'storageFull');
      assert.equal(error.measuredBytes, stateBytes(expected));
      assert.equal(error.budgetBytes, 8 * 1024 * 1024);
      return true;
    }
  );
  assert.equal(attempts, 1);
  assert.deepEqual(persistence.values[global.Tango.STORAGE_KEY], state);
  assert.deepEqual(persistence.values[global.Tango.SETTINGS_KEY], settings);
});
```

- [ ] **Step 2: Make the background harness injectable and add a failing response-envelope test**

Change the `loadBackground` declaration and its `chrome.storage.local.set` implementation in `tests/background.test.js` to:

```js
function loadBackground(
  fetchImpl,
  clock = { now: 1_000_000 },
  { storageSet } = {}
) {
```

```js
          set: async (next) => {
            if (storageSet) return storageSet(next, storageValues);
            Object.assign(storageValues, structuredClone(next));
          }
```

Append this test:

```js
test('service worker returns typed storageFull byte details from its coordinator', async () => {
  let attempts = 0;
  const loaded = loadBackground(
    async () => { throw new Error('must not fetch'); },
    { now: 2_000 },
    {
      storageSet: async () => {
        attempts += 1;
        const error = new Error('QUOTA_BYTES quota exceeded');
        error.name = 'QuotaExceededError';
        throw error;
      }
    }
  );

  const response = await send(loaded, {
    type: 'TANGO_STORE_MUTATE',
    command: { type: 'RESET_ALL' }
  });

  assert.equal(response.ok, false);
  assert.equal(response.error, 'storageFull');
  assert.equal(response.errorDetails.code, 'storageFull');
  assert.ok(response.errorDetails.measuredBytes > 0);
  assert.equal(response.errorDetails.budgetBytes, 8 * 1024 * 1024);
  assert.equal(attempts, 1);
});
```

- [ ] **Step 3: Add a failing Store-side typed-error reconstruction test**

Append to `tests/storage.test.js`:

```js
test('Store reconstructs typed storage failure details from the service worker', async () => {
  const chrome = {
    runtime: {
      async sendMessage() {
        return {
          ok: false,
          error: 'importTooLarge',
          errorDetails: {
            code: 'importTooLarge',
            measuredBytes: 9_437_184,
            budgetBytes: 8_388_608
          }
        };
      }
    },
    storage: {
      local: { get: async () => ({}), set: async () => undefined },
      onChanged: { addListener() {} }
    }
  };
  const { store } = loadStore({ chrome });

  await assert.rejects(store.importData({}), (error) => {
    assert.equal(error.message, 'importTooLarge');
    assert.equal(error.code, 'importTooLarge');
    assert.equal(error.measuredBytes, 9_437_184);
    assert.equal(error.budgetBytes, 8_388_608);
    return true;
  });
});
```

- [ ] **Step 4: Run all three focused tests and verify RED**

Run:

```powershell
node --test --test-name-pattern="native quota failure|typed storageFull|reconstructs typed storage" tests/state-coordinator.test.js tests/background.test.js tests/storage.test.js
```

Expected failures:

- coordinator exposes the browser's raw quota error rather than `storageFull`;
- background response has no `errorDetails`;
- Store reconstructs only `new Error(response.error)` and loses byte fields.

- [ ] **Step 5: Add native quota recognition and one-attempt write normalization**

Add before `create` in `src/core/state-coordinator.js`:

```js
  function isNativeStorageQuotaError(error) {
    const name = String(error?.name || '');
    const code = String(error?.code || '');
    const message = String(error?.message || '');
    return name === 'QuotaExceededError'
      || code === 'QUOTA_BYTES'
      || /(?:QUOTA_BYTES|quota\s+(?:has been\s+)?exceeded|storage\s+full)/i.test(message);
  }
```

Inside `create`, immediately after `prepareState`, add:

```js
    async function writeStored(values, stateForDetails) {
      try {
        await writeRaw(values);
      } catch (error) {
        if (!isNativeStorageQuotaError(error)) throw error;
        throw storageBudgetError(
          'storageFull',
          serializedStateBytes(stateForDetails),
          stateBudgetBytes,
          error
        );
      }
    }
```

Replace every coordinator `await writeRaw(...)` with `await writeStored(..., stateForDetails)`. Use these exact detail states:

```js
// Migration
await writeStored({
  [Tango.STORAGE_KEY]: state,
  [Tango.SETTINGS_KEY]: settings
}, state);

// Generic state commit
await writeStored({ [Tango.STORAGE_KEY]: prepared.state }, prepared.state);

// INITIALIZE
await writeStored({
  [Tango.STORAGE_KEY]: prepared.state,
  [Tango.SETTINGS_KEY]: nextSettings
}, prepared.state);

// IMPORT
await writeStored({
  [Tango.STORAGE_KEY]: importedState,
  [Tango.SETTINGS_KEY]: importedSettings
}, importedState);

// RESET_ALL_WITH_BALANCE and RESET_CHAIN
await writeStored({
  [Tango.STORAGE_KEY]: prepared.state,
  [Tango.SETTINGS_KEY]: nextSettings
}, prepared.state);

// SAVE_SETTINGS and PATCH_SETTINGS
await writeStored({ [Tango.SETTINGS_KEY]: nextSettings }, state);
```

Do not catch `storageFull` outside `writeStored` and do not issue a second write.

- [ ] **Step 6: Serialize typed details in the background while retaining string compatibility**

Add before `chrome.runtime.onMessage.addListener` in `src/background.js`:

```js
function coordinatorFailureResponse(error) {
  const response = {
    ok: false,
    error: error?.message || 'storageFailed'
  };
  if (['storageFull', 'importTooLarge'].includes(error?.code)
    && Number.isSafeInteger(error?.measuredBytes)
    && Number.isSafeInteger(error?.budgetBytes)) {
    response.errorDetails = {
      code: error.code,
      measuredBytes: error.measuredBytes,
      budgetBytes: error.budgetBytes
    };
  }
  return response;
}
```

Replace both coordinator catch callbacks with:

```js
      .catch((error) => sendResponse(coordinatorFailureResponse(error)));
```

This applies to `TANGO_STORE_GET_ALL` and `TANGO_STORE_MUTATE`; unrelated background message contracts remain unchanged.

- [ ] **Step 7: Reconstruct typed details in the Store client**

Replace `sendCoordinatorMessage` in `src/core/storage.js` with:

```js
  async function sendCoordinatorMessage(message) {
    const response = await global.chrome.runtime.sendMessage(message);
    if (!response?.ok) {
      const error = new Error(response?.error || 'storageFailed');
      const details = response?.errorDetails;
      if (details && ['storageFull', 'importTooLarge'].includes(details.code)
        && Number.isSafeInteger(details.measuredBytes)
        && Number.isSafeInteger(details.budgetBytes)) {
        error.code = details.code;
        error.measuredBytes = details.measuredBytes;
        error.budgetBytes = details.budgetBytes;
      }
      throw error;
    }
    return response.result;
  }
```

- [ ] **Step 8: Run focused and subsystem tests and verify GREEN**

Run:

```powershell
node --test --test-name-pattern="native quota failure|typed storageFull|reconstructs typed storage" tests/state-coordinator.test.js tests/background.test.js tests/storage.test.js
node --test tests/state-coordinator.test.js tests/background.test.js tests/storage.test.js
```

Expected: all focused and subsystem tests pass; each native quota attempt writes once, and typed fields survive the worker boundary.

- [ ] **Step 9: Commit the coordinator-to-Store typed failure path**

```powershell
git add src/core/state-coordinator.js src/background.js src/core/storage.js tests/state-coordinator.test.js tests/background.test.js tests/storage.test.js
git commit -m "fix: preserve typed storage failures across contexts"
```

### Task 4: Report Lossless Import Size in the Dashboard

**Files:**
- Modify: `src/shared/i18n.js:37,105`
- Modify: `src/dashboard/dashboard.js:581-590`
- Modify: `tests/dashboard-runtime.test.js:54-292`

**Interfaces:**
- Consumes: Store error `{ code: 'importTooLarge', measuredBytes, budgetBytes }`.
- Produces: localized `importTooLarge` toast with both sizes formatted to two decimal MiB places.
- Preserves: generic invalid backups continue to use `importFailed`; rejected import never assigns `runtime.state` or `runtime.settings`.

- [ ] **Step 1: Extend only the Dashboard test harness capabilities needed by the regression**

Add `importFailure = null` to the `loadDashboard` options destructuring in `tests/dashboard-runtime.test.js`:

```js
  initialState = null, initialSettings = null, importFailure = null
```

Extend the fake translation function with the byte-aware message:

```js
      t: (key, _language, vars) => key === 'onboardingCapitalAllocation'
        ? `${key}:${vars?.amount}`
        : key === 'importTooLarge'
          ? `${key}:${vars?.measured}/${vars?.budget}`
          : key
```

Replace the fake Store import method with:

```js
      async importData() {
        if (importFailure) throw importFailure;
        return { state: persistedState, settings: persistedSettings };
      },
```

Add `fileInput` to the returned harness object:

```js
    api: context.__dashboardTest, calls, app, element, anchors, urls, refreshedSettings,
    resetAllWithBalanceGate, openGmgnGate, document, context, initialLoadError, fileInput,
```

- [ ] **Step 2: Add the failing Dashboard lossless-import UI test**

Append to `tests/dashboard-runtime.test.js`:

```js
test('Dashboard reports oversized import bytes and keeps authoritative data unchanged', async () => {
  const initialState = stateFixture();
  const initialSettings = settingsFixture();
  const error = new Error('importTooLarge');
  error.code = 'importTooLarge';
  error.measuredBytes = 9 * 1024 * 1024;
  error.budgetBytes = 8 * 1024 * 1024;
  const dashboard = await loadDashboard({
    initialState,
    initialSettings,
    importFailure: error
  });
  dashboard.fileInput.files = [{
    text: async () => JSON.stringify({ product: 'Tango Paper Trader' })
  }];

  await dashboard.fileInput.emit('change');

  assert.equal(dashboard.api.runtime.toast, 'importTooLarge:9.00/8.00');
  assert.equal(JSON.stringify(dashboard.api.runtime.state), JSON.stringify(initialState));
  assert.equal(JSON.stringify(dashboard.api.runtime.settings), JSON.stringify(initialSettings));
  assert.equal(dashboard.fileInput.value, '');
});
```

- [ ] **Step 3: Run the focused Dashboard test and verify RED**

Run:

```powershell
node --test --test-name-pattern="Dashboard reports oversized import bytes" tests/dashboard-runtime.test.js
```

Expected: `FAIL` because the current catch block always shows `importFailed` and discards the typed byte details.

- [ ] **Step 4: Add bilingual byte-aware import text**

Add this entry to the English message object in `src/shared/i18n.js`:

```js
      importTooLarge: 'Backup is {measured} MiB; the lossless import limit is {budget} MiB. Nothing was changed.',
```

Add this entry to the `zh-CN` message object:

```js
      importTooLarge: '备份为 {measured} MiB，超过 {budget} MiB 的无损导入上限，现有数据未更改。',
```

- [ ] **Step 5: Render typed import details without assigning rejected data**

Replace the `catch` block of the file-input change handler in `src/dashboard/dashboard.js` with:

```js
    } catch (error) {
      if (error?.code === 'importTooLarge'
        && Number.isSafeInteger(error.measuredBytes)
        && Number.isSafeInteger(error.budgetBytes)) {
        const toMiB = (bytes) => (bytes / (1024 * 1024)).toFixed(2);
        showToast(t('importTooLarge', {
          measured: toMiB(error.measuredBytes),
          budget: toMiB(error.budgetBytes)
        }));
      } else {
        showToast(t('importFailed'));
      }
```

Keep the existing `finally` block immediately afterward so the selected file is cleared for both outcomes.

- [ ] **Step 6: Run Dashboard and i18n consumers and verify GREEN**

Run:

```powershell
node --test --test-name-pattern="Dashboard reports oversized import bytes" tests/dashboard-runtime.test.js
node --test tests/dashboard-runtime.test.js tests/content-runtime.test.js tests/popup-runtime.test.js
```

Expected: all tests pass, the special toast contains `9.00/8.00`, and generic import failures retain their existing message.

- [ ] **Step 7: Commit the Dashboard reporting behavior**

```powershell
git add src/shared/i18n.js src/dashboard/dashboard.js tests/dashboard-runtime.test.js
git commit -m "feat: report lossless import size limits"
```

### Task 5: Full Regression, Permission Check, and Package Parity

**Files:**
- Verify: `manifest.json`
- Verify: generated `dist/tango-paper-trader/**`

**Interfaces:**
- Confirms: no `unlimitedStorage` permission.
- Confirms: packaged runtime copies equal the changed source assets byte-for-byte.

- [ ] **Step 1: Run the complete project tests**

```powershell
npm.cmd test
```

Expected: every test passes with zero failures, warnings, or unhandled rejections.

- [ ] **Step 2: Run static validation**

```powershell
npm.cmd run check
```

Expected: extension validation succeeds.

- [ ] **Step 3: Prove the manifest did not gain unlimited storage**

```powershell
node -e "const manifest=require('./manifest.json'); if(manifest.permissions?.includes('unlimitedStorage')) throw new Error('unlimitedStorage is forbidden'); if(JSON.stringify(manifest.permissions)!==JSON.stringify(['storage'])) throw new Error('unexpected permission change');"
```

Expected: exit code `0` with no output.

- [ ] **Step 4: Build the unpacked extension**

```powershell
npm.cmd run build
```

Expected: build succeeds at `dist/tango-paper-trader`.

- [ ] **Step 5: Verify source/package parity for every changed runtime asset**

```powershell
$changedRuntime = @(
  'src/shared/constants.js',
  'src/core/state-coordinator.js',
  'src/background.js',
  'src/core/storage.js',
  'src/shared/i18n.js',
  'src/dashboard/dashboard.js'
)
foreach ($file in $changedRuntime) {
  $sourceHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $file).Hash
  $builtHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path 'dist/tango-paper-trader' $file)).Hash
  if ($sourceHash -ne $builtHash) { throw "Package parity failed: $file" }
}
```

Expected: exit code `0`; every changed runtime file is identical in source and package output.

- [ ] **Step 6: Inspect the final scoped diff**

```powershell
git status --short
git diff --check
git diff --stat
```

Expected: no whitespace errors; only the files named in this plan and independently authorized parallel work appear. Do not stage unrelated user files.

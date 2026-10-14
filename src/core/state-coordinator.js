(function initStateCoordinator(global) {
  const Tango = global.Tango = global.Tango || {};
  const TRUSTED_METADATA_SOURCES = new Set(['GMGN_TRENCH', 'GMGN_DETAIL', 'GMGN_NETWORK']);

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
      const tradesOverLimit = remainingTrades > Tango.MAX_TRADES;
      const calibrationsOverLimit = remainingCalibrations > Tango.MAX_TRADES;
      if (measuredBytes <= budgetBytes && !tradesOverLimit && !calibrationsOverLimit) break;
      const trades = unit.entries.filter(({ collection }) => collection === 'trade');
      const calibrations = unit.entries.filter(({ collection }) => collection === 'calibration');
      if (measuredBytes <= budgetBytes
        && !(tradesOverLimit && trades.length) && !(calibrationsOverLimit && calibrations.length)) continue;
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
    if (measuredBytes > budgetBytes
      || remainingTrades > Tango.MAX_TRADES || remainingCalibrations > Tango.MAX_TRADES) {
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

  function canonicalizeFallbackOrder(order, executionNow) {
    const quote = order?.quote;
    const token = order?.token;
    const chain = Tango.Chains.get(token?.chain);
    const declaredSupply = String(quote?.supplySource || '');
    const fallbackIntent = quote?.paperFallback === true
      && quote?.syntheticTokenPrice === true
      && (String(quote?.source || '').toUpperCase() === 'TANGO_FALLBACK'
        || String(quote?.priceProvenance || '').toUpperCase().startsWith('FALLBACK_'))
      && (!declaredSupply || declaredSupply === 'UNKNOWN_FALLBACK');
    const quoteSource = String(quote?.source || '').toUpperCase();
    const quotePriceSource = String(quote?.priceSource || quote?.source || '').toUpperCase();
    const nativeOnlyProvisional = quote?.provisional === true
      && quote?.syntheticTokenPrice !== true
      && quote?.syntheticNativePrice === true
      && Number(quote?.nativePriceUsd) === 1
      && Number(quote?.nativeOriginalObservedAt || 0) === 0;
    const factualPriceFallbackShape = quote?.paperFallback === true
      && (quote?.provisional !== true || nativeOnlyProvisional)
      && quote?.syntheticTokenPrice !== true
      && quote?.valuationMode === 'PRICE'
      && quote?.valuationSource === 'OBSERVED_PRICE'
      && quote?.priceProvenance === 'OBSERVED_PRICE'
      && declaredSupply === 'UNKNOWN_FALLBACK'
      && ['GMGN', 'GMGN_TRENCH', 'GMGN_DETAIL', 'GMGN_NETWORK'].includes(quoteSource)
      && quotePriceSource === quoteSource
      && String(quote?.marketCapSource || '').toUpperCase() === 'TANGO_FALLBACK'
      && Number(quote?.marketCapObservedAt || 0) === 0
      && String(quote?.marketCapObservationId || '') === ''
      && Number(quote?.marketCapUsd) === Number(Tango.Supply?.UNKNOWN_INITIAL_MARKET_CAP_USD || 3_200)
      && Number(quote?.totalSupply) === Number(Tango.Supply?.UNKNOWN_TOTAL_SUPPLY || 1_000_000_000)
      && Number(quote?.marketCapDivisor) === Number(Tango.Supply?.UNKNOWN_TOTAL_SUPPLY || 1_000_000_000)
      && Number(quote?.provisionalSupply) === Number(Tango.Supply?.UNKNOWN_TOTAL_SUPPLY || 1_000_000_000)
      && Number.isFinite(Number(quote?.priceUsd)) && Number(quote.priceUsd) > 0;
    const candidatePriceObservedAt = Number(
      quote?.priceObservedAt ?? quote?.originalObservedAt ?? quote?.observedAt
    );
    const coherentFactualPriceFallback = factualPriceFallbackShape
      && Number.isSafeInteger(candidatePriceObservedAt)
      && candidatePriceObservedAt > 0
      && candidatePriceObservedAt <= executionNow
      && executionNow - candidatePriceObservedAt <= Number(Tango.QUOTE_STALE_MS || 15_000);
    if (!chain || (!fallbackIntent && !factualPriceFallbackShape)) return order;

    const trustedMetadata = token?.metadataVerified === true
      && TRUSTED_METADATA_SOURCES.has(String(token?.metadataSource || '').toUpperCase());
    const launchpad = trustedMetadata ? String(token?.launchpad || '') : '';
    const launchMode = trustedMetadata ? String(token?.launchMode || '') : '';
    const fallback = Tango.Supply.fallbackValuation({
      chain: chain.id, launchpad, launchMode
    });
    const unknownFallback = fallback.supplySource === 'UNKNOWN_FALLBACK';
    if (coherentFactualPriceFallback && unknownFallback) {
      const canonicalQuote = {
        ...quote,
        ...fallback,
        chain: chain.id,
        address: token?.address,
        launchpad,
        launchMode,
        totalSupply: fallback.totalSupply,
        marketCapDivisor: fallback.totalSupply,
        provisionalSupply: fallback.totalSupply,
        marketCapUsd: fallback.marketCapUsd,
        priceUsd: Number(quote.priceUsd),
        marketCapSource: 'TANGO_FALLBACK',
        marketCapObservedAt: 0,
        marketCapObservationId: '',
        observedAt: executionNow,
        priceObservedAt: candidatePriceObservedAt,
        originalObservedAt: candidatePriceObservedAt,
        source: quoteSource,
        priceSource: quotePriceSource,
        valuationMode: 'PRICE',
        valuationSource: 'OBSERVED_PRICE',
        priceProvenance: 'OBSERVED_PRICE',
        syntheticTokenPrice: false,
        provisional: nativeOnlyProvisional,
        paperFallback: true
      };
      delete canonicalQuote.provisionalSupplyProvenance;
      return { ...order, quote: canonicalQuote };
    }
    const candidateMarketCapUsd = Number(quote?.marketCapUsd);
    const candidatePriceUsd = Number(quote?.priceUsd);
    const candidateMarketCapSource = String(quote?.marketCapSource || '').toUpperCase();
    const candidateMarketCapObservedAt = Number(
      quote?.marketCapObservedAt || quote?.originalObservedAt || 0
    );
    const coherentObservedMarketCap = quote?.valuationSource === 'CARD_MARKET_CAP_FALLBACK_SUPPLY'
      && quote?.valuationMode === 'MARKET_CAP'
      && String(quote?.source || '').toUpperCase() === 'TANGO_FALLBACK'
      && quote?.provisionalSupplyProvenance == null
      && ['GMGN_TRENCH', 'GMGN_DETAIL', 'GMGN_NETWORK'].includes(candidateMarketCapSource)
      && Number.isSafeInteger(candidateMarketCapObservedAt)
      && candidateMarketCapObservedAt > 0
      && candidateMarketCapObservedAt <= executionNow
      && executionNow - candidateMarketCapObservedAt <= Number(Tango.QUOTE_STALE_MS || 15_000)
      && Number.isFinite(candidateMarketCapUsd) && candidateMarketCapUsd > 0
      && Number(quote?.totalSupply) === fallback.totalSupply
      && Number(quote?.marketCapDivisor) === fallback.totalSupply
      && Number(quote?.provisionalSupply) === fallback.totalSupply
      && Number.isFinite(candidatePriceUsd) && candidatePriceUsd > 0
      && Math.abs(candidatePriceUsd - candidateMarketCapUsd / fallback.totalSupply)
        <= Math.max(Number.EPSILON, candidatePriceUsd * 1e-9);
    const executionMarketCapUsd = coherentObservedMarketCap
      ? candidateMarketCapUsd : fallback.marketCapUsd;
    const canonicalQuote = {
      ...quote,
      ...fallback,
      chain: chain.id,
      address: token?.address,
      launchpad,
      launchMode,
      totalSupply: fallback.totalSupply,
      marketCapDivisor: fallback.totalSupply,
      provisionalSupply: unknownFallback ? fallback.totalSupply : 0,
      marketCapUsd: executionMarketCapUsd,
      priceUsd: executionMarketCapUsd / fallback.totalSupply,
      observedAt: executionNow,
      priceObservedAt: coherentObservedMarketCap
        ? candidateMarketCapObservedAt : executionNow,
      priceSource: coherentObservedMarketCap
        ? candidateMarketCapSource : 'TANGO_FALLBACK',
      priceObservationId: coherentObservedMarketCap
        ? String(quote?.priceObservationId || '') : '',
      marketCapSource: coherentObservedMarketCap
        ? candidateMarketCapSource : 'TANGO_FALLBACK',
      marketCapObservedAt: coherentObservedMarketCap ? candidateMarketCapObservedAt : 0,
      marketCapObservationId: coherentObservedMarketCap
        ? String(quote?.marketCapObservationId || '') : '',
      observationId: coherentObservedMarketCap ? String(quote?.observationId || '') : '',
      source: coherentObservedMarketCap
        ? 'TANGO_FALLBACK_CARD_MARKET_CAP' : 'TANGO_FALLBACK',
      valuationMode: 'MARKET_CAP',
      valuationSource: coherentObservedMarketCap
        ? 'CARD_MARKET_CAP_FALLBACK_SUPPLY' : fallback.valuationSource,
      originalObservedAt: coherentObservedMarketCap ? candidateMarketCapObservedAt : 0,
      priceProvenance: 'FALLBACK_INITIAL_MARKET_CAP',
      syntheticTokenPrice: true,
      provisional: true,
      paperFallback: true
    };
    delete canonicalQuote.provisionalSupplyProvenance;
    return { ...order, quote: canonicalQuote };
  }

  function isNativeStorageQuotaError(error) {
    const name = String(error?.name || '');
    const code = String(error?.code || '');
    const message = String(error?.message || '');
    return name === 'QuotaExceededError'
      || code === 'QUOTA_BYTES'
      || /(?:QUOTA_BYTES|quota\s+(?:has been\s+)?exceeded|storage\s+full)/i.test(message);
  }

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
      for (let index = next.length - 1; index >= 0; index -= 1) {
        const record = next[index];
        const id = String(record?.id || '');
        const count = remaining.get(id) || 0;
        if (count > 0) remaining.set(id, count - 1);
        else indexes.push(index);
      }
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

    let tail = Promise.resolve();

    function serialized(work) {
      const result = tail.then(work);
      tail = result.then(() => undefined, () => undefined);
      return result;
    }

    async function readSnapshot({
      persistMigration = true,
      migrateInMemory = persistMigration
    } = {}) {
      const raw = await readRaw([Tango.STORAGE_KEY, Tango.SETTINGS_KEY]);
      const settings = Tango.State.normalizeSettings(raw[Tango.SETTINGS_KEY]);
      const storedState = raw[Tango.STORAGE_KEY];
      let state = Tango.State.normalizeState(storedState, settings, { migrationNow: now() });
      const migrationPending = Number(storedState?.schemaVersion) === 1;
      if (migrationPending && migrateInMemory) {
        state.stateRevision = Number(storedState.stateRevision || 0) + 1;
        state = prepareState(state, settings).state;
      }
      if (migrationPending && persistMigration) {
        await writeStored({
          [Tango.STORAGE_KEY]: state,
          [Tango.SETTINGS_KEY]: settings
        }, state);
      }
      return { state, settings, migrationPending: migrationPending && migrateInMemory };
    }

    async function commitState(previous, next, settings, {
      persistSettings = false,
      protectedTradeIndexes = [],
      protectedCalibrationIndexes = []
    } = {}) {
      const revised = {
        ...next,
        stateRevision: Number(previous.stateRevision || 0) + 1
      };
      const detected = historyProtection(previous, revised);
      const prepared = prepareState(revised, settings, {
        protectedTradeIndexes: [...new Set([
          ...detected.protectedTradeIndexes,
          ...protectedTradeIndexes
        ])],
        protectedCalibrationIndexes: [...new Set([
          ...detected.protectedCalibrationIndexes,
          ...protectedCalibrationIndexes
        ])]
      });
      await writeStored({
        [Tango.STORAGE_KEY]: prepared.state,
        ...(persistSettings ? { [Tango.SETTINGS_KEY]: settings } : {})
      }, prepared.state);
      return prepared.state;
    }

    function getAll() {
      return serialized(readSnapshot);
    }

    function mutate(command) {
      return serialized(async () => {
        const { state, settings, migrationPending } = await readSnapshot({
          persistMigration: false,
          migrateInMemory: true
        });
        const storedRevision = Math.max(
          0,
          Number(state.stateRevision || 0) - (migrationPending ? 1 : 0)
        );
        if (['EXECUTE_BUY', 'EXECUTE_SELL', 'EXECUTE_CLOSE_ALL'].includes(command?.type)
          && settings.enabled !== true) throw new Error('paperTradingDisabled');
        if (command?.type === 'INITIALIZE') {
          const balance = Number(command.defaultBalanceNative ?? 10);
          if (!Number.isFinite(balance) || balance < Number.EPSILON || balance > 1e15) {
            throw new Error('invalidResetPrincipal');
          }
          const nextSettings = Tango.State.normalizeSettings({
            ...settings,
            ...(command.language === undefined ? {} : { language: command.language }),
            chains: Object.fromEntries(Tango.Chains.all().map((chain) => [chain.id, {
              ...settings.chains[chain.id], initialBalanceNative: balance
            }]))
          }, { strict: true, requireAllChains: true });
          const initialBalances = Object.fromEntries(Tango.Chains.all().map((chain) => [chain.id, balance]));
          const initialized = Tango.State.createInitialState({ now: now(), initialBalances });
          initialized.initialized = true;
          initialized.stateRevision = Number(state.stateRevision || 0) + 1;
          const prepared = prepareState(initialized, nextSettings);
          await writeStored({
            [Tango.STORAGE_KEY]: prepared.state,
            [Tango.SETTINGS_KEY]: nextSettings
          }, prepared.state);
          return { state: prepared.state, settings: nextSettings };
        }
        if (command?.type === 'SAVE_SETTINGS') {
          const nextSettings = Tango.State.normalizeSettings(command.settings, { strict: true });
          const nextState = migrationPending ? prepareState(state, nextSettings).state : state;
          await writeStored({
            ...(migrationPending ? { [Tango.STORAGE_KEY]: nextState } : {}),
            [Tango.SETTINGS_KEY]: nextSettings
          }, nextState);
          return { state: nextState, settings: nextSettings };
        }
        if (command?.type === 'PATCH_SETTINGS') {
          const patch = command.patch;
          if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('invalidSettings');
          const { chains: chainPatches, ...topLevelPatch } = patch;
          const chains = { ...settings.chains };
          if (chainPatches !== undefined) {
            if (!chainPatches || typeof chainPatches !== 'object' || Array.isArray(chainPatches)) {
              throw new Error('invalidSettings');
            }
            const canonicalChainIds = new Set(Tango.Chains.all().map((chain) => chain.id));
            for (const [chainId, chainPatch] of Object.entries(chainPatches)) {
              if (!canonicalChainIds.has(chainId) || !chainPatch
                || typeof chainPatch !== 'object' || Array.isArray(chainPatch)) {
                throw new Error('invalidSettings');
              }
              chains[chainId] = { ...chains[chainId], ...chainPatch };
            }
          }
          const nextSettings = Tango.State.normalizeSettings({
            ...settings,
            ...topLevelPatch,
            chains
          }, { strict: true, requireAllChains: true });
          const nextState = migrationPending ? prepareState(state, nextSettings).state : state;
          await writeStored({
            ...(migrationPending ? { [Tango.STORAGE_KEY]: nextState } : {}),
            [Tango.SETTINGS_KEY]: nextSettings
          }, nextState);
          return { state: nextState, settings: nextSettings };
        }
        if (command?.type === 'IMPORT') {
          const payload = command.payload;
          if (!payload || payload.product !== 'Tango Paper Trader' || !payload.state || !payload.settings
            || !Number.isSafeInteger(payload.exportedAt) || payload.exportedAt < 0) {
            throw new Error('importFailed');
          }
          const importedSettings = Tango.State.normalizeSettings(payload.settings, {
            strict: true,
            requireAllChains: Number(payload.state.schemaVersion) === 2
          });
          const importedState = Tango.State.normalizeState(payload.state, importedSettings, {
            strict: true,
            migrationNow: payload.exportedAt,
            maximumTimestamp: payload.exportedAt
          });
          importedState.initialized = true;
          importedState.stateRevision = storedRevision + 1;
          const measuredBytes = serializedStateBytes(importedState);
          if (measuredBytes > stateBudgetBytes) {
            throw storageBudgetError('importTooLarge', measuredBytes, stateBudgetBytes);
          }
          await writeStored({
            [Tango.STORAGE_KEY]: importedState,
            [Tango.SETTINGS_KEY]: importedSettings
          }, importedState);
          return { state: importedState, settings: importedSettings };
        }
        if (command?.type === 'RESET_ALL_WITH_BALANCE') {
          const balanceNative = command.balanceNative;
          if (typeof balanceNative !== 'number' || !Number.isFinite(balanceNative)
            || balanceNative <= Number.EPSILON || balanceNative > 1e15) {
            throw new Error('invalidResetPrincipal');
          }
          const patch = command.settingsPatch === undefined ? {} : command.settingsPatch;
          if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('invalidSettings');
          const { chains: chainPatches, ...topLevelPatch } = patch;
          const patchedChains = { ...settings.chains };
          if (chainPatches !== undefined) {
            if (!chainPatches || typeof chainPatches !== 'object' || Array.isArray(chainPatches)) {
              throw new Error('invalidSettings');
            }
            const canonicalChainIds = new Set(Tango.Chains.all().map((chain) => chain.id));
            for (const [chainId, chainPatch] of Object.entries(chainPatches)) {
              if (!canonicalChainIds.has(chainId) || !chainPatch
                || typeof chainPatch !== 'object' || Array.isArray(chainPatch)) {
                throw new Error('invalidSettings');
              }
              patchedChains[chainId] = { ...patchedChains[chainId], ...chainPatch };
            }
          }
          const nextSettings = Tango.State.normalizeSettings({
            ...settings,
            ...topLevelPatch,
            ...(command.language === undefined ? {} : { language: command.language }),
            chains: Object.fromEntries(Tango.Chains.all().map((chain) => [chain.id, {
              ...patchedChains[chain.id],
              initialBalanceNative: balanceNative
            }]))
          }, { strict: true, requireAllChains: true });
          const nextState = Tango.State.resetAll(nextSettings, now());
          nextState.stateRevision = storedRevision + 1;
          const prepared = prepareState(nextState, nextSettings);
          await writeStored({
            [Tango.STORAGE_KEY]: prepared.state,
            [Tango.SETTINGS_KEY]: nextSettings
          }, prepared.state);
          return { state: prepared.state, settings: nextSettings };
        }
        let result;
        let protectedTradeIndexes = [];
        let protectedCalibrationIndexes = [];
        if (command?.type === 'EXECUTE_BUY') {
          const executionNow = now();
          result = Tango.Engine.executeBuy(
            state, canonicalizeFallbackOrder(command.order, executionNow), settings, executionNow
          );
          protectedTradeIndexes = [0];
          if (result.calibration) protectedCalibrationIndexes = [0];
        } else if (command?.type === 'EXECUTE_SELL') {
          const executionNow = now();
          result = Tango.Engine.executeSell(
            state, canonicalizeFallbackOrder(command.order, executionNow), settings, executionNow
          );
          protectedTradeIndexes = [0];
          if (result.calibration) protectedCalibrationIndexes = [0];
        } else if (command?.type === 'EXECUTE_CLOSE_ALL') {
          const executionNow = now();
          result = Tango.Engine.executeCloseAll(
            state,
            command.chain,
            (command.orders || []).map((order) => canonicalizeFallbackOrder(order, executionNow)),
            settings,
            executionNow
          );
          protectedTradeIndexes = result.trades.map((_, index) => index);
          protectedCalibrationIndexes = result.calibrations.map((_, index) => index);
        } else if (command?.type === 'UPDATE_POSITION_QUOTE') {
          const updated = Tango.Engine.updatePositionQuoteResult(
            state, command.token, command.quote, now()
          );
          result = { state: updated.state };
          if (updated.calibration) protectedCalibrationIndexes = [0];
        } else if (command?.type === 'UPDATE_POSITION_METADATA') {
          result = { state: Tango.Engine.updatePositionMetadata(state, command.token) };
        } else if (command?.type === 'UPDATE_POSITION_METADATA_BATCH') {
          let next = state;
          for (const token of command.tokens || []) next = Tango.Engine.updatePositionMetadata(next, token);
          result = { state: next };
        } else if (command?.type === 'RESET_CHAIN') {
          const chain = Tango.Chains.get(command.chain);
          if (!chain) throw new Error('unsupportedChain');
          const balanceNative = command.balanceNative;
          if (typeof balanceNative !== 'number' || !Number.isFinite(balanceNative)
            || balanceNative < Number.EPSILON || balanceNative > 1e15) {
            throw new Error('invalidResetPrincipal');
          }
          const nextState = Tango.State.resetChain(state, chain.id, balanceNative, now());
          nextState.stateRevision = storedRevision + 1;
          const nextSettings = Tango.State.normalizeSettings({
            ...settings,
            chains: {
              ...settings.chains,
              [chain.id]: { ...settings.chains[chain.id], initialBalanceNative: balanceNative }
            }
          });
          const prepared = prepareState(nextState, nextSettings);
          await writeStored({
            [Tango.STORAGE_KEY]: prepared.state,
            [Tango.SETTINGS_KEY]: nextSettings
          }, prepared.state);
          return { state: prepared.state, settings: nextSettings };
        } else if (command?.type === 'RESET_ALL') {
          result = { state: Tango.State.resetAll(settings, now()) };
        } else if (command?.type === 'REPLACE_STATE') {
          if (Number(command.expectedRevision) !== Number(state.stateRevision)) throw new Error('stateConflict');
          result = { state: Tango.State.normalizeState(command.state, settings) };
        } else {
          throw new Error('unsupportedMutation');
        }
        if (result.state === state) {
          if (!migrationPending) return result;
          const prepared = prepareState(state, settings);
          await writeStored({
            [Tango.STORAGE_KEY]: prepared.state,
            [Tango.SETTINGS_KEY]: settings
          }, prepared.state);
          return { ...result, state: prepared.state };
        }
        const committed = await commitState(state, result.state, settings, {
          persistSettings: migrationPending,
          protectedTradeIndexes,
          protectedCalibrationIndexes
        });
        return { ...result, state: committed };
      });
    }

    return { getAll, mutate };
  }

  Tango.StateCoordinator = { create, serializedStateBytes, compactStateForStorage };
  if (typeof module !== 'undefined' && module.exports) module.exports = Tango.StateCoordinator;
})(globalThis);

(function initStateCoordinator(global) {
  const Tango = global.Tango = global.Tango || {};
  const TRUSTED_METADATA_SOURCES = new Set(['GMGN_TRENCH', 'GMGN_DETAIL', 'GMGN_NETWORK']);

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

  function create({ readRaw, writeRaw, now = () => Date.now() } = {}) {
    if (typeof readRaw !== 'function' || typeof writeRaw !== 'function') {
      throw new Error('invalidCoordinatorStorage');
    }
    let tail = Promise.resolve();

    function serialized(work) {
      const result = tail.then(work);
      tail = result.then(() => undefined, () => undefined);
      return result;
    }

    async function readSnapshot({ persistMigration = true } = {}) {
      const raw = await readRaw([Tango.STORAGE_KEY, Tango.SETTINGS_KEY]);
      const settings = Tango.State.normalizeSettings(raw[Tango.SETTINGS_KEY]);
      const storedState = raw[Tango.STORAGE_KEY];
      const state = Tango.State.normalizeState(storedState, settings, { migrationNow: now() });
      if (persistMigration && Number(storedState?.schemaVersion) === 1) {
        state.stateRevision = Number(storedState.stateRevision || 0) + 1;
        await writeRaw({
          [Tango.STORAGE_KEY]: state,
          [Tango.SETTINGS_KEY]: settings
        });
      }
      return { state, settings };
    }

    async function commitState(previous, next) {
      const state = {
        ...next,
        stateRevision: Number(previous.stateRevision || 0) + 1
      };
      await writeRaw({ [Tango.STORAGE_KEY]: state });
      return state;
    }

    function getAll() {
      return serialized(readSnapshot);
    }

    function mutate(command) {
      return serialized(async () => {
        const { state, settings } = await readSnapshot({
          persistMigration: !['RESET_CHAIN', 'RESET_ALL_WITH_BALANCE', 'IMPORT'].includes(command?.type)
        });
        if (command?.type === 'INITIALIZE') {
          const nextSettings = Tango.State.normalizeSettings({ ...settings, language: command.language });
          const balance = Number(command.defaultBalanceNative ?? 10);
          const initialBalances = Object.fromEntries(Tango.Chains.all().map((chain) => [chain.id, balance]));
          const initialized = Tango.State.createInitialState({ now: now(), initialBalances });
          initialized.initialized = true;
          initialized.stateRevision = Number(state.stateRevision || 0) + 1;
          await writeRaw({
            [Tango.STORAGE_KEY]: initialized,
            [Tango.SETTINGS_KEY]: nextSettings
          });
          return { state: initialized, settings: nextSettings };
        }
        if (command?.type === 'SAVE_SETTINGS') {
          const nextSettings = Tango.State.normalizeSettings(command.settings);
          await writeRaw({ [Tango.SETTINGS_KEY]: nextSettings });
          return { state, settings: nextSettings };
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
          await writeRaw({ [Tango.SETTINGS_KEY]: nextSettings });
          return { state, settings: nextSettings };
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
            migrationNow: payload.exportedAt
          });
          importedState.initialized = true;
          importedState.stateRevision = Number(state.stateRevision || 0) + 1;
          await writeRaw({
            [Tango.STORAGE_KEY]: importedState,
            [Tango.SETTINGS_KEY]: importedSettings
          });
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
          nextState.stateRevision = Number(state.stateRevision || 0) + 1;
          await writeRaw({
            [Tango.STORAGE_KEY]: nextState,
            [Tango.SETTINGS_KEY]: nextSettings
          });
          return { state: nextState, settings: nextSettings };
        }
        let result;
        if (command?.type === 'EXECUTE_BUY') {
          const executionNow = now();
          result = Tango.Engine.executeBuy(
            state, canonicalizeFallbackOrder(command.order, executionNow), settings, executionNow
          );
        } else if (command?.type === 'EXECUTE_SELL') {
          const executionNow = now();
          result = Tango.Engine.executeSell(
            state, canonicalizeFallbackOrder(command.order, executionNow), settings, executionNow
          );
        } else if (command?.type === 'EXECUTE_CLOSE_ALL') {
          const executionNow = now();
          result = Tango.Engine.executeCloseAll(
            state,
            command.chain,
            (command.orders || []).map((order) => canonicalizeFallbackOrder(order, executionNow)),
            settings,
            executionNow
          );
        } else if (command?.type === 'UPDATE_POSITION_QUOTE') {
          result = { state: Tango.Engine.updatePositionQuote(state, command.token, command.quote, now()) };
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
          nextState.stateRevision = Number(state.stateRevision || 0) + 1;
          const nextSettings = Tango.State.normalizeSettings({
            ...settings,
            chains: {
              ...settings.chains,
              [chain.id]: { ...settings.chains[chain.id], initialBalanceNative: balanceNative }
            }
          });
          await writeRaw({
            [Tango.STORAGE_KEY]: nextState,
            [Tango.SETTINGS_KEY]: nextSettings
          });
          return { state: nextState, settings: nextSettings };
        } else if (command?.type === 'RESET_ALL') {
          result = { state: Tango.State.resetAll(settings, now()) };
        } else if (command?.type === 'REPLACE_STATE') {
          if (Number(command.expectedRevision) !== Number(state.stateRevision)) throw new Error('stateConflict');
          result = { state: Tango.State.normalizeState(command.state, settings) };
        } else {
          throw new Error('unsupportedMutation');
        }
        if (result.state === state) return result;
        const committed = await commitState(state, result.state);
        return { ...result, state: committed };
      });
    }

    return { getAll, mutate };
  }

  Tango.StateCoordinator = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = Tango.StateCoordinator;
})(globalThis);

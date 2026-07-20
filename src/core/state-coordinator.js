(function initStateCoordinator(global) {
  const Tango = global.Tango = global.Tango || {};

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
          persistMigration: !['RESET_CHAIN', 'IMPORT'].includes(command?.type)
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
        let result;
        if (command?.type === 'EXECUTE_BUY') {
          result = Tango.Engine.executeBuy(state, command.order, settings, now());
        } else if (command?.type === 'EXECUTE_SELL') {
          result = Tango.Engine.executeSell(state, command.order, settings, now());
        } else if (command?.type === 'EXECUTE_CLOSE_ALL') {
          result = Tango.Engine.executeCloseAll(state, command.chain, command.orders, settings, now());
        } else if (command?.type === 'UPDATE_POSITION_QUOTE') {
          result = { state: Tango.Engine.updatePositionQuote(state, command.token, command.quote) };
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

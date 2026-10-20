const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const chainsSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'chains.js'), 'utf8');
const constantsSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'constants.js'), 'utf8');
const stateSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'state.js'), 'utf8');
const engineSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'engine.js'), 'utf8');
const coordinatorSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'state-coordinator.js'), 'utf8');
const storageSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'storage.js'), 'utf8');

function loadStore(overrides = {}) {
  const context = vm.createContext({
    Promise, JSON, Object, Array, Number, Set,
    ...overrides
  });
  vm.runInContext(chainsSource, context);
  vm.runInContext(constantsSource, context);
  vm.runInContext(stateSource, context);
  vm.runInContext(engineSource, context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..','src','core','review-notes.js'),'utf8'), context);
  vm.runInContext(coordinatorSource, context);
  vm.runInContext(storageSource, context);
  return { store: context.Tango.Store, tango: context.Tango };
}

test('invalidated extension contexts require a refresh and never resubmit later orders', async () => {
  for (const asynchronous of [false, true]) {
    let sends = 0;
    const { store } = loadStore({ chrome: {
      runtime: { sendMessage() {
        sends += 1;
        const error = new Error('Extension context invalidated.');
        if (asynchronous) return Promise.reject(error);
        throw error;
      } },
      storage: { local: {}, onChanged: { addListener() {} } }
    } });
    await assert.rejects(store.executeBuy({}), { message: 'extensionReloadRequired' });
    await assert.rejects(store.executeBuy({}), { message: 'extensionReloadRequired' });
    await assert.rejects(store.executeSell({}), { message: 'extensionReloadRequired' });
    await assert.rejects(store.getAll(), { message: 'extensionReloadRequired' });
    assert.equal(sends, 1, 'a dead context cannot submit more paper commands');
  }
});

test('transient coordinator errors retain their original reason and allow later explicit orders', async () => {
  let sends = 0;
  const { store } = loadStore({ chrome: {
    runtime: { async sendMessage() {
      sends += 1;
      if (sends === 1) throw new Error('Could not establish connection. Receiving end does not exist.');
      return { ok: true, result: { state: {} } };
    } },
    storage: { local: {}, onChanged: { addListener() {} } }
  } });
  await assert.rejects(store.executeBuy({}), /Could not establish connection/);
  assert.equal(sends, 1, 'failed orders are not retried automatically');
  await store.executeBuy({});
  assert.equal(sends, 2);
});

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

test('Store rejects malformed or spoofed typed details and preserves the legacy error string', async () => {
  const cases = [
    {
      name: 'negative measured bytes',
      response: {
        ok: false, error: 'storageFull',
        errorDetails: { code: 'storageFull', measuredBytes: -1, budgetBytes: 1 }
      }
    },
    {
      name: 'zero budget',
      response: {
        ok: false, error: 'storageFull',
        errorDetails: { code: 'storageFull', measuredBytes: 1, budgetBytes: 0 }
      }
    },
    {
      name: 'import not over budget',
      response: {
        ok: false, error: 'importTooLarge',
        errorDetails: { code: 'importTooLarge', measuredBytes: 1, budgetBytes: 1 }
      }
    },
    {
      name: 'legacy error mismatch spoof',
      response: {
        ok: false, error: 'importFailed',
        errorDetails: { code: 'importTooLarge', measuredBytes: 2, budgetBytes: 1 }
      }
    },
    {
      name: 'unsupported code',
      response: {
        ok: false, error: 'storageFailed',
        errorDetails: { code: 'storageFailed', measuredBytes: 2, budgetBytes: 1 }
      }
    },
    {
      name: 'malformed details',
      response: { ok: false, error: 'importFailed', errorDetails: null }
    }
  ];

  for (const item of cases) {
    const chrome = {
      runtime: { sendMessage: async () => item.response },
      storage: {
        local: { get: async () => ({}), set: async () => undefined },
        onChanged: { addListener() {} }
      }
    };
    const { store } = loadStore({ chrome });

    await assert.rejects(store.importData({}), (error) => {
      assert.equal(error.message, item.response.error, item.name);
      assert.equal(Object.hasOwn(error, 'code'), false, item.name);
      assert.equal(Object.hasOwn(error, 'measuredBytes'), false, item.name);
      assert.equal(Object.hasOwn(error, 'budgetBytes'), false, item.name);
      return true;
    });
  }
});

test('Store reconstructs valid storageFull details at the zero measured-byte boundary', async () => {
  const chrome = {
    runtime: {
      async sendMessage() {
        return {
          ok: false,
          error: 'storageFull',
          errorDetails: { code: 'storageFull', measuredBytes: 0, budgetBytes: 1 }
        };
      }
    },
    storage: {
      local: { get: async () => ({}), set: async () => undefined },
      onChanged: { addListener() {} }
    }
  };
  const { store } = loadStore({ chrome });

  await assert.rejects(store.getAll(), (error) => {
    assert.equal(error.message, 'storageFull');
    assert.equal(error.code, 'storageFull');
    assert.equal(error.measuredBytes, 0);
    assert.equal(error.budgetBytes, 1);
    return true;
  });
});

test('localStorage fallback notifies subscribers once per scoped settings write', async () => {
  const values = new Map();
  const { store } = loadStore({
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value)
    }
  });
  let notifications = 0;
  store.subscribe(() => { notifications += 1; });
  await store.patchSettings({ language: 'en' });
  await Promise.resolve();
  assert.equal(notifications, 1);
});

test('chrome.storage scoped settings write relies on onChanged and notifies subscribers once', async () => {
  let onChanged;
  const values = {};
  const chrome = {
    storage: {
      local: {
        get: async (keys) => Object.fromEntries(keys.filter((key) => key in values).map((key) => [key, values[key]])),
        set: async (next) => {
          const changes = Object.fromEntries(Object.entries(next).map(([key, newValue]) => [key, { oldValue: values[key], newValue }]));
          Object.assign(values, next);
          queueMicrotask(() => onChanged?.(changes, 'local'));
        }
      },
      onChanged: { addListener: (listener) => { onChanged = listener; } }
    }
  };
  const { store } = loadStore({ chrome, queueMicrotask });
  let notifications = 0;
  store.subscribe(() => { notifications += 1; });
  await store.patchSettings({ language: 'zh-CN' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(notifications, 1);
});

test('invalid import leaves existing stored state unchanged', async () => {
  const values = new Map();
  const { store, tango } = loadStore({
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value)
    }
  });
  await store.initialize(10, 'en');
  const before = values.get(tango.STORAGE_KEY);
  const invalid = tango.State.createInitialState({ now: 1 });
  invalid.positions['eth:bad'] = { chain: 'eth', tokenAddress: 'bad', quantity: 1 };
  await assert.rejects(
    store.importData({
      product: 'Tango Paper Trader', exportedAt: 1,
      state: invalid, settings: tango.State.normalizeSettings({})
    }),
    /invalidPosition/
  );
  assert.equal(values.get(tango.STORAGE_KEY), before);
});

test('chain reset leaves other chain accounts intact and reset all recreates all accounts', async () => {
  const values = new Map();
  const { store } = loadStore({
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value)
    }
  });
  const initialized = await store.initialize(10, 'en');
  initialized.state.accounts.eth.cashBalanceNative = 4;
  initialized.state.accounts.bsc.cashBalanceNative = 7;
  await store.saveState(initialized.state);
  const chainReset = await store.resetChain('eth');
  assert.equal(chainReset.accounts.eth.cashBalanceNative, 10);
  assert.equal(chainReset.accounts.bsc.cashBalanceNative, 7);
  const allReset = await store.resetAll();
  assert.equal(allReset.schemaVersion, 2);
  assert.equal(allReset.accounts.eth.cashBalanceNative, 10);
  assert.equal(allReset.accounts.bsc.cashBalanceNative, 10);
});

test('resetAllWithBalance exposes one common-capital coordinator mutation', async () => {
  const messages = [];
  const chrome = {
    runtime: {
      async sendMessage(message) {
        messages.push(message);
        return { ok: true, result: { state: { initialized: true }, settings: { language: 'zh-CN' } } };
      }
    },
    storage: {
      local: { get: async () => ({}), set: async () => undefined },
      onChanged: { addListener() {} }
    }
  };
  const { store } = loadStore({ chrome });

  assert.equal(typeof store.resetAllWithBalance, 'function');
  const result = await store.resetAllWithBalance(42, 'zh-CN');

  assert.equal(result.state.initialized, true);
  assert.equal(JSON.stringify(messages), JSON.stringify([{
    type: 'TANGO_STORE_MUTATE',
    command: { type: 'RESET_ALL_WITH_BALANCE', balanceNative: 42, language: 'zh-CN' }
  }]));
});

test('storage clients expose intent mutations instead of requiring caller-owned state writes', async () => {
  const values = new Map();
  const { store } = loadStore({
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value)
    }
  });
  await store.initialize(10, 'en');
  const now = Date.now();
  const result = await store.executeBuy({
    token: { chain: 'eth', address: '0x7777777777777777777777777777777777777777' },
    quote: { priceUsd: 2, nativePriceUsd: 2_000, observedAt: now, nativePriceObservedAt: now },
    amountNative: 1
  });

  assert.equal(result.trade.chain, 'eth');
  assert.equal(result.state.accounts.eth.cashBalanceNative, 9);
  assert.equal((await store.getAll()).state.accounts.eth.cashBalanceNative, 9);
});

test('patchSettings exposes queued scoped settings merges while saveSettings remains compatible', async () => {
  const values = new Map();
  const { store } = loadStore({
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value)
    }
  });
  const initial = await store.saveSettings({
    selectedChain: 'sol',
    language: 'en',
    chains: { eth: { buyPresets: [1, 2], networkFeeNative: 0.002, initialBalanceNative: 20 } }
  });

  const patched = await store.patchSettings({
    selectedChain: 'eth',
    chains: { eth: { networkFeeNative: 0.01 } }
  });

  assert.equal(patched.selectedChain, 'eth');
  assert.equal(patched.language, 'en');
  assert.equal(patched.chains.eth.networkFeeNative, 0.01);
  assert.deepEqual(Array.from(patched.chains.eth.buyPresets), Array.from(initial.chains.eth.buyPresets));
  assert.equal(patched.chains.eth.initialBalanceNative, initial.chains.eth.initialBalanceNative);
});

test('extension pages route reads and mutations to the service-worker coordinator', async () => {
  const expectedState = { schemaVersion: 2, stateRevision: 4, initialized: true };
  const expectedSettings = { selectedChain: 'eth' };
  const messages = [];
  const chrome = {
    runtime: {
      async sendMessage(message) {
        messages.push(message);
        if (message.type === 'TANGO_STORE_GET_ALL') {
          return { ok: true, result: { state: expectedState, settings: expectedSettings } };
        }
        return { ok: true, result: { state: { ...expectedState, stateRevision: 5 }, trade: { side: 'BUY' } } };
      }
    },
    storage: {
      local: {
        get: async () => { throw new Error('page must not coordinate directly'); },
        set: async () => { throw new Error('page must not coordinate directly'); }
      },
      onChanged: { addListener() {} }
    }
  };
  const { store } = loadStore({ chrome });

  const snapshot = await store.getAll();
  const bought = await store.executeBuy({ token: {}, quote: {}, amountNative: 1 });

  assert.equal(snapshot.state.stateRevision, 4);
  assert.equal(bought.state.stateRevision, 5);
  assert.deepEqual(messages.map((message) => message.type), ['TANGO_STORE_GET_ALL', 'TANGO_STORE_MUTATE']);
  assert.equal(messages[1].command.type, 'EXECUTE_BUY');
});

test('journal storage exports roundtrip notes and notifies independently of paper accounts', async () => {
 const values=new Map();const {store}=loadStore({localStorage:{getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)}});
 let accountEvents=0,noteEvents=0;store.subscribe(()=>accountEvents++);store.subscribeReviews(()=>noteEvents++);
 const address='0x1111111111111111111111111111111111111111';
 await store.saveReviewNote({chain:'bsc',address,date:'2026-10-18',text:'local note',symbol:'CAT',name:'Cat',expectedEpoch:0,expectedRevision:0});
 await Promise.resolve();assert.equal(accountEvents,0);assert.equal(noteEvents,1);
 const backup=await store.exportData();assert.equal(Object.values(backup.reviewNotes.records)[0].text,'local note');
 await store.importData(backup);await Promise.resolve();assert.equal(noteEvents,2);assert.equal((await store.getReviewNotes()).epoch,1);
 const legacy={...backup};delete legacy.reviewNotes;await store.importData(legacy);assert.equal(Object.values((await store.getReviewNotes()).records)[0].text,'local note');
});

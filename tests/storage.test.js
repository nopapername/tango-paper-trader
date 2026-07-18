const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const chainsSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'chains.js'), 'utf8');
const constantsSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'constants.js'), 'utf8');
const stateSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'state.js'), 'utf8');
const storageSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'storage.js'), 'utf8');

function loadStore(overrides = {}) {
  const context = vm.createContext({
    Promise, JSON, Object, Array, Number, Set,
    ...overrides
  });
  vm.runInContext(chainsSource, context);
  vm.runInContext(constantsSource, context);
  vm.runInContext(stateSource, context);
  vm.runInContext(storageSource, context);
  return { store: context.Tango.Store, tango: context.Tango };
}

test('localStorage fallback notifies subscribers once per write', async () => {
  const values = new Map();
  const { store } = loadStore({
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value)
    }
  });
  let notifications = 0;
  store.subscribe(() => { notifications += 1; });
  await store.saveState({ schemaVersion: 1, account: {}, positions: {}, trades: [], dailyRealized: {} });
  await Promise.resolve();
  assert.equal(notifications, 1);
});

test('chrome.storage write relies on onChanged and notifies subscribers once', async () => {
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
  await store.saveSettings({ initialBalanceSol: 100, language: 'zh-CN' });
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
    store.importData({ product: 'Tango Paper Trader', state: invalid, settings: {} }),
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

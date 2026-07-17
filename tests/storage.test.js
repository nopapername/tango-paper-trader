const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const storageSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'storage.js'), 'utf8');

function createTango() {
  return {
    STORAGE_KEY: 'tango-state',
    SETTINGS_KEY: 'tango-settings',
    MAX_TRADES: 10_000,
    VERSION: 'test',
    DEFAULT_SETTINGS: { initialBalanceSol: 100, language: 'en' },
    createInitialState(initialBalanceSol) {
      return {
        schemaVersion: 1, initialized: false,
        account: { cashBalanceSol: Number(initialBalanceSol) },
        positions: {}, trades: [], dailyRealized: {}
      };
    }
  };
}

function loadStore(overrides = {}) {
  const context = vm.createContext({
    Tango: createTango(), Promise, JSON, Object, Array, Number, Set,
    ...overrides
  });
  vm.runInContext(storageSource, context);
  return context.Tango.Store;
}

test('localStorage fallback notifies subscribers once per write', async () => {
  const values = new Map();
  const store = loadStore({
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
  const store = loadStore({ chrome, queueMicrotask });
  let notifications = 0;
  store.subscribe(() => { notifications += 1; });
  await store.saveSettings({ initialBalanceSol: 100, language: 'zh-CN' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(notifications, 1);
});

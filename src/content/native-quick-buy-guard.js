(function initNativeQuickBuyGuard(global) {
  const Tango = global.Tango = global.Tango || {};
  if (Tango.NativeQuickBuyGuard) return;

  const settingsKey = Tango.SETTINGS_KEY || 'tangoPaperTraderSettingsV1';
  const trustedPaperActions = new WeakMap();
  const consumedTrustedClicks = new WeakSet();
  const protectedEvents = [
    'pointerdown', 'pointerup', 'pointercancel', 'mousedown', 'mouseup',
    'touchstart', 'touchend', 'click', 'auxclick', 'keydown', 'keyup'
  ];
  let blockNativeQuickBuy = true;
  let settingsRevision = 0;

  function eventElements(event) {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
    return path.filter((node) => node instanceof global.Element);
  }

  function isNativeQuickBuy(node) {
    return node.matches?.('[data-testid="quickbuy"]')
      || node.matches?.('.BuyButton-continer')
      || node.matches?.('[data-sentry-component="BuyButtons"]');
  }

  function captureNativeAncestors(slot) {
    const ancestors = [];
    for (let ancestor = slot?.parentElement;
      ancestor instanceof global.Element;
      ancestor = ancestor.parentElement) {
      if (isNativeQuickBuy(ancestor)) ancestors.push(ancestor);
    }
    return Object.freeze(ancestors);
  }

  function currentPaperCoreIdentity(element, identity) {
    const bindingNonce = String(identity?.bindingNonce || '');
    const state = String(identity?.state || '');
    return element instanceof global.Element
      && identity?.element === element
      && identity?.slot instanceof global.Element
      && identity?.card instanceof global.Element
      && identity?.binding
      && identity.binding.replacement === element
      && identity.binding.actionId === identity.actionId
      && identity.binding.bindingNonce === bindingNonce
      && identity.binding.generation === identity.generation
      && identity.binding.state === state
      && identity.binding.chain === identity.chain
      && identity.binding.address === identity.address
      && identity.binding.href === identity.href
      && Number(identity.binding.amountNative) === Number(identity.amountNative)
      && identity.binding.validate === identity.validate
      && typeof identity.validate === 'function'
      && typeof identity.activate === 'function'
      && identity.binding.action?.invoke === identity.activate
      && ['resolving-identity', 'ready', 'in-flight'].includes(state)
      && element.dataset?.tangoPaperAction === 'quick-buy'
      && element.dataset?.tangoActionId === identity.actionId
      && element.dataset?.tangoBindingNonce === bindingNonce
      && element.dataset?.tangoCardGeneration === String(identity.generation)
      && element.dataset?.tangoPaperState === state
      && identity.slot.dataset?.tangoActionId === identity.actionId
      && identity.slot.dataset?.tangoBindingNonce === bindingNonce
      && identity.slot.dataset?.tangoCardGeneration === String(identity.generation)
      && identity.slot.__tangoQuickBuyBinding === identity.binding
      && identity.slot.__tangoReplacementQuickBuy === element
      && identity.slot.contains?.(element) === true
      && identity.slot.matches?.('.BuyButton-continer') === true
      && identity.slot.closest?.('[class~="group/a"]') === identity.card
      && identity.slot.__tangoQuickBuyCard === identity.card
      && identity.card.contains?.(identity.slot) === true
      && element.isConnected === true
      && identity.slot.isConnected === true
      && identity.card.isConnected === true;
  }

  function sameNativeAncestors(left, right) {
    return left.length === right.length && left.every((ancestor, index) => ancestor === right[index]);
  }

  function pathAuthorizesPaper(elements, identity) {
    const paperIndex = elements.indexOf(identity.element);
    const slotIndex = elements.indexOf(identity.slot);
    if (paperIndex < 0 || slotIndex <= paperIndex) return false;
    return elements.slice(paperIndex + 1, slotIndex).every((element) => !isNativeQuickBuy(element));
  }

  function trustedPaperCoreIdentity(element) {
    const identity = trustedPaperActions.get(element);
    if (!identity) return null;
    if (currentPaperCoreIdentity(element, identity)) {
      try {
        if (identity.validate() === true) return identity;
      } catch {}
    }
    trustedPaperActions.delete(element);
    return null;
  }

  function trustedPaperActionBeforeNative(elements) {
    let trustedIdentity = null;
    for (const element of elements) {
      if (!trustedIdentity) trustedIdentity = trustedPaperCoreIdentity(element);
      if (!isNativeQuickBuy(element)) continue;
      if (!trustedIdentity || !pathAuthorizesPaper(elements, trustedIdentity)) return null;
      const currentAncestors = captureNativeAncestors(trustedIdentity.slot);
      if (!sameNativeAncestors(trustedIdentity.nativeAncestors, currentAncestors)) {
        trustedIdentity = Object.freeze({
          ...trustedIdentity,
          nativeAncestors: currentAncestors
        });
        trustedPaperActions.set(trustedIdentity.element, trustedIdentity);
      }
      if (trustedIdentity.slot === element || trustedIdentity.nativeAncestors.includes(element)) continue;
      return null;
    }
    return trustedIdentity;
  }

  function stopActivation(event, preventDefault) {
    if (preventDefault) event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  function blockNativeActivation(event) {
    if (!blockNativeQuickBuy) return;
    if ((event.type === 'keydown' || event.type === 'keyup')
      && event.key !== 'Enter' && event.key !== ' ') return;
    const elements = eventElements(event);
    const identity = trustedPaperActionBeforeNative(elements);
    if (identity) {
      const click = event.type === 'click';
      const trustedPrimaryClick = click
        && event.isTrusted === true
        && (event.button == null || event.button === 0);
      stopActivation(event, click || event.type === 'auxclick' || event.isTrusted !== true);
      if (!trustedPrimaryClick || consumedTrustedClicks.has(event)) return;
      consumedTrustedClicks.add(event);
      identity.element.dataset.tangoLastActivationStatus = 'guard-dispatched';
      try {
        Promise.resolve(identity.activate()).catch(() => null);
      } catch {}
      return;
    }
    if (!elements.some((element) => isNativeQuickBuy(element)
      || element.matches?.('[data-tango-paper-action="quick-buy"]'))) return;
    stopActivation(event, true);
    if (event.type === 'click' && event.isTrusted === true
      && (event.button == null || event.button === 0)) {
      const paper = elements.find(element => element.matches?.('[data-tango-paper-action="quick-buy"]'));
      if (paper) paper.dataset.tangoLastActivationStatus = 'guard-blocked-binding';
    }
  }

  function applySettings(settings) {
    blockNativeQuickBuy = settings?.enabled !== false;
  }

  const storage = global.chrome?.storage;
  storage?.onChanged?.addListener?.((changes, areaName) => {
    if (areaName !== 'local'
      || !Object.prototype.hasOwnProperty.call(changes || {}, settingsKey)) return;
    settingsRevision += 1;
    applySettings(changes[settingsKey]?.newValue);
  });

  const initialRevision = settingsRevision;
  try {
    const initialRead = storage?.local?.get?.(settingsKey);
    if (initialRead) {
      Promise.resolve(initialRead).then((values) => {
        if (settingsRevision === initialRevision) applySettings(values?.[settingsKey]);
      }).catch(() => null);
    }
  } catch {}

  Object.defineProperty(Tango, 'NativeQuickBuyGuard', {
    configurable: false,
    enumerable: false,
    writable: false,
    value: Object.freeze({
      registerPaperAction(element, identity, activate) {
        if (!(element instanceof global.Element) || typeof activate !== 'function') return false;
        const descriptor = Object.freeze({
          element,
          slot: identity?.slot,
          card: identity?.card,
          binding: identity?.binding,
          actionId: identity?.actionId,
          bindingNonce: identity?.bindingNonce,
          generation: identity?.generation,
          state: identity?.state,
          chain: identity?.chain,
          address: identity?.address,
          href: identity?.href,
          amountNative: identity?.amountNative,
          validate: identity?.validate,
          activate,
          nativeAncestors: captureNativeAncestors(identity?.slot)
        });
        if (!currentPaperCoreIdentity(element, descriptor)) {
          trustedPaperActions.delete(element);
          return false;
        }
        trustedPaperActions.set(element, descriptor);
        return true;
      },
      isPaperActionTrusted(element, identity) {
        const descriptor = trustedPaperCoreIdentity(element);
        return Boolean(descriptor)
          && currentPaperCoreIdentity(element, { ...identity, element, activate: descriptor.activate })
          && sameNativeAncestors(descriptor.nativeAncestors, captureNativeAncestors(descriptor.slot));
      },
      revokePaperAction(element) {
        return element instanceof global.Element && trustedPaperActions.delete(element);
      }
    })
  });

  protectedEvents.forEach((type) => {
    global.addEventListener(type, blockNativeActivation, { capture: true, passive: false });
  });
})(globalThis);

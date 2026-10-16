(function initChains(global) {
  const Tango = global.Tango = global.Tango || {};
  const presets = Object.freeze([0.1, 0.2, 0.5, 1, 2, 3, 5, 10]);
  const definitions = [
    ['sol', 'Solana', 'SOL', 'solana', 'solana', 'So11111111111111111111111111111111111111112'],
    ['eth', 'Ethereum', 'ETH', 'ethereum', 'ethereum', ''],
    ['bsc', 'BNB Chain', 'BNB', 'binancecoin', 'bsc', ''],
    ['base', 'Base', 'ETH', 'ethereum', 'base', ''],
    ['robinhood', 'Robinhood Chain', 'ETH', 'ethereum', '', ''],
    ['xlayer', 'X Layer', 'OKB', 'okb', 'xlayer', '']
  ];
  const chains = Object.freeze(definitions.map(([id, name, nativeSymbol, coingeckoId, dexScreenerChain, wrappedNativeAddress]) => Object.freeze({
    id, gmgnSlug: id, name, nativeSymbol, nativePriceKey: coingeckoId, coingeckoId,
    addressFamily: id === 'sol' ? 'SOLANA' : 'EVM',
    dexScreenerChain: dexScreenerChain || null,
    wrappedNativeAddress: wrappedNativeAddress || null,
    defaultBuyPresets: presets,
    defaultNetworkFeeNative: 0.001,
    capabilities: Object.freeze({ detail: true, trench: true, chart: true })
  })));
  const byId = new Map(chains.map((chain) => [chain.id, chain]));
  const base58Alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const get = (id) => byId.get(String(id || '').toLowerCase()) || null;
  const requireChain = (id) => { const chain = get(id); if (!chain) throw new Error('unsupportedChain'); return chain; };
  const normalizeAddress = (chainId, address) => {
    const chain = requireChain(chainId); const value = String(address || '').trim();
    return chain.addressFamily === 'EVM' ? value.toLowerCase() : value;
  };
  const decodedBase58Length = (value) => {
    const bytes = [0];
    for (const character of value) {
      let carry = base58Alphabet.indexOf(character);
      if (carry < 0) return -1;
      for (let index = 0; index < bytes.length; index += 1) {
        carry += bytes[index] * 58;
        bytes[index] = carry & 0xff;
        carry >>= 8;
      }
      while (carry > 0) {
        bytes.push(carry & 0xff);
        carry >>= 8;
      }
    }
    let leadingZeroBytes = 0;
    while (value[leadingZeroBytes] === '1') leadingZeroBytes += 1;
    const significantBytes = bytes.length === 1 && bytes[0] === 0 ? 0 : bytes.length;
    return leadingZeroBytes + significantBytes;
  };
  const validateAddress = (chainId, address) => {
    const chain = get(chainId); const value = String(address || '').trim();
    if (!chain) return false;
    return chain.addressFamily === 'EVM'
      ? /^0x[a-fA-F0-9]{40}$/.test(value)
      : /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value) && decodedBase58Length(value) === 32;
  };
  const fromUrl = (value) => {
    let url; try { url = new URL(String(value || '')); } catch { return null; }
    if (url.hostname !== 'gmgn.ai') return null;
    const pathSlug = url.pathname.split('/').filter(Boolean)[0];
    const pathChain = chains.find((chain) => chain.gmgnSlug === String(pathSlug || '').toLowerCase());
    return pathChain || get(url.searchParams.get('chain'));
  };
  const tokenUrl = (chainId, address) => {
    const chain = requireChain(chainId);
    if (!validateAddress(chain.id, address)) throw new Error('invalidAddress');
    return `https://gmgn.ai/${chain.gmgnSlug}/token/${encodeURIComponent(normalizeAddress(chain.id, address))}`;
  };
  const trenchUrl = (chainId) => `https://gmgn.ai/?chain=${encodeURIComponent(requireChain(chainId).gmgnSlug)}`;
  Tango.Chains = { all: () => chains.slice(), get, require: requireChain, fromUrl, normalizeAddress, validateAddress, tokenUrl, trenchUrl };
  if (typeof module !== 'undefined' && module.exports) module.exports = Tango.Chains;
})(globalThis);

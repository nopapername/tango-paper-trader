(function initFormat(global) {
  const Tango = global.Tango = global.Tango || {};

  function compact(value, language, maximumFractionDigits = 2) {
    if (!Number.isFinite(Number(value))) return '--';
    return new Intl.NumberFormat(language === 'zh-CN' ? 'zh-CN' : 'en-US', {
      notation: 'compact', maximumFractionDigits
    }).format(Number(value));
  }

  function number(value, language, digits = 4) {
    if (!Number.isFinite(Number(value))) return '--';
    return new Intl.NumberFormat(language === 'zh-CN' ? 'zh-CN' : 'en-US', {
      maximumFractionDigits: digits
    }).format(Number(value));
  }

  function native(value, symbol, language, signed = false) {
    if (!Number.isFinite(Number(value))) return '--';
    const numeric = Number(value || 0);
    const sign = signed && numeric > 0 ? '+' : numeric < 0 ? '-' : '';
    return `${sign}${number(Math.abs(numeric), language, 4)} ${String(symbol || '').trim()}`.trim();
  }

  function sol(value, language, signed = false) {
    return native(value, 'SOL', language, signed);
  }

  function percent(value, language, signed = false) {
    if (!Number.isFinite(Number(value))) return '--';
    const numeric = Number(value);
    const sign = signed && numeric > 0 ? '+' : '';
    return `${sign}${number(numeric, language, 2)}%`;
  }

  function usd(value, language, compactMode = false) {
    if (!Number.isFinite(Number(value))) return '--';
    const numeric = Number(value);
    if (compactMode) return `$${compact(numeric, language, 2)}`;
    const digits = Math.abs(numeric) < 0.01 ? 10 : 4;
    return `$${number(numeric, language, digits)}`;
  }

  function duration(ms, language) {
    const seconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ${minutes % 60}m`;
    const days = Math.floor(hours / 24);
    return language === 'zh-CN' ? `${days}天 ${hours % 24}小时` : `${days}d ${hours % 24}h`;
  }

  Tango.Format = { compact, number, native, sol, percent, usd, duration };
})(globalThis);

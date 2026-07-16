(function initI18n(global) {
  const Tango = global.Tango = global.Tango || {};

  const messages = {
    en: {
      paper: 'PAPER', paperBuy: 'Paper Buy', paperSell: 'Paper Sell', balance: 'Balance', equity: 'Total Equity', todayPnl: 'Today PnL',
      totalPnl: 'Total PnL', positions: 'Positions', history: 'History', settings: 'Settings',
      buy: 'Buy', sell: 'Sell', simulateBuy: 'SIMULATE BUY', simulateSell: 'SIMULATE SELL',
      price: 'Price', marketCap: 'Market Cap', liquidity: 'Liquidity', updated: 'Updated',
      position: 'Position', pnl: 'PnL', pnlAmount: 'PnL Amount', entryMc: 'Entry MC', currentMc: 'Current MC',
      exitMc: 'Exit MC', multiple: 'Multiple', custom: 'Custom', close: 'Close',
      cancel: 'Cancel', confirm: 'Confirm', simulatedBuy: 'Simulated Buy', simulatedSell: 'Simulated Sell',
      investment: 'Investment', observedPrice: 'Observed Price', executionPrice: 'Execution Price',
      slippage: 'Simulated Slippage', tradingFee: 'Trading Fee', networkFee: 'Network Fee',
      insufficientBalance: 'Insufficient paper balance', invalidQuote: 'Live price is unavailable',
      staleQuote: 'Price is stale. Wait for a fresh GMGN quote.', invalidAmount: 'Enter a valid amount',
      noPosition: 'No open position', tradeFilled: 'Paper trade filled', openDashboard: 'Open Dashboard',
      resetAccount: 'Reset Account', exportCsv: 'Export CSV', exportJson: 'Export JSON',
      importJson: 'Import JSON', language: 'Language', displayCurrency: 'Display Currency',
      fastMode: 'Fast Mode', confirmTrades: 'Confirm trades', quickBuy: 'Paper Buy',
      openPositions: 'OPEN POSITIONS', value: 'Value', cost: 'Cost', held: 'Held',
      overview: 'Overview', calendar: 'Calendar', tradeHistory: 'Trade History',
      realizedPnl: 'Realized PnL', unrealizedPnl: 'Unrealized PnL', winRate: 'Win Rate',
      profitFactor: 'Profit Factor', totalTrades: 'Total Trades', side: 'Side', token: 'Token',
      amount: 'Amount', date: 'Date', noTrades: 'No paper trades yet', noPositions: 'No open positions',
      welcome: 'Practice meme trading on real GMGN charts', startingBalance: 'Starting Balance',
      startPaperTrading: 'Start Paper Trading', paperOnly: 'No wallet. No real funds.',
      resetWarning: 'This permanently deletes all local paper trades and positions.',
      resetConfirm: 'Reset all paper trading data?', dataImported: 'Data imported', importFailed: 'Invalid backup file',
      share: 'Share', downloadPng: 'Download PNG', copyImage: 'Copy image', simulatedTrade: 'SIMULATED TRADE · NO REAL FUNDS',
      gmgnOnly: 'Open a GMGN Solana token page to paper trade.', auto: 'Auto', chinese: '简体中文', english: 'English',
      safe: 'Safe', advanced: 'Advanced', closed: 'Closed', totalBuy: 'Total Buy', totalSell: 'Total Sell',
      totalProfit: 'Total Profit', paperBalance: 'Paper Balance', totalAssets: 'Total Assets', breakeven: 'Recover Cost',
      breakevenUnavailable: 'Current value cannot recover the remaining cost', pressEnter: 'Press Enter',
      editPresets: 'Edit presets', savePresets: 'Save presets', presetsSaved: 'Presets saved',
      invalidPresets: 'Enter 8 valid preset values',
      skipConfirmSession: "Don't ask again until the browser restarts", enabled: 'Extension enabled',
      disabled: 'All Tango features are off', setup: 'Set up paper account', setupHint: 'Choose a language and starting paper balance here.',
      customBalance: 'Custom balance', buySuccess: 'Paper buy successful', sellSuccess: 'Paper sell successful',
      sound: 'Trade sounds', setupInPopup: 'Open the Tango extension popup to finish setup.',
      accountSettings: 'Language & paper principal', resetWithBalance: 'Reset with this balance',
      resetBalanceConfirm: 'Reset the paper account and delete all trades?', openDashboardFailed: 'Could not open the dashboard',
      dragToMove: 'Drag to move', openToken: 'Open token on GMGN', clickForPositions: 'Click to view positions',
      quoteLoading: 'Quote is updating. Please try again.',
      lastKnownPrice: 'This page cannot read the token’s live GMGN price. A sell will use the most recently recorded price.'
    },
    'zh-CN': {
      paper: '模拟盘', paperBuy: '虚拟买入', paperSell: '虚拟卖出', balance: '虚拟余额', equity: '账户净值', todayPnl: '今日盈亏',
      totalPnl: '总盈亏', positions: '持仓', history: '历史', settings: '设置',
      buy: '买入', sell: '卖出', simulateBuy: '模拟买入', simulateSell: '模拟卖出',
      price: '价格', marketCap: '市值', liquidity: '流动性', updated: '更新时间',
      position: '当前持仓', pnl: '盈亏', pnlAmount: '盈亏数额', entryMc: '入场市值', currentMc: '当前市值',
      exitMc: '出场市值', multiple: '倍数', custom: '自定义', close: '平仓',
      cancel: '取消', confirm: '确认', simulatedBuy: '模拟买入', simulatedSell: '模拟卖出',
      investment: '投入金额', observedPrice: '观察价格', executionPrice: '模拟成交价',
      slippage: '模拟滑点', tradingFee: '平台费', networkFee: '网络费',
      insufficientBalance: '虚拟余额不足', invalidQuote: '无法获得实时价格',
      staleQuote: '价格已过期，请等待 GMGN 更新', invalidAmount: '请输入有效金额',
      noPosition: '当前没有持仓', tradeFilled: '模拟成交成功', openDashboard: '打开数据面板',
      resetAccount: '重置账户', exportCsv: '导出 CSV', exportJson: '导出 JSON',
      importJson: '导入 JSON', language: '语言', displayCurrency: '显示货币',
      fastMode: '快速模式', confirmTrades: '交易前确认', quickBuy: '模拟买入',
      openPositions: '当前持仓', value: '价值', cost: '成本', held: '持仓时间',
      overview: '概览', calendar: '日历', tradeHistory: '交易历史',
      realizedPnl: '已实现盈亏', unrealizedPnl: '未实现盈亏', winRate: '胜率',
      profitFactor: '盈亏比', totalTrades: '交易次数', side: '方向', token: '代币',
      amount: '金额', date: '日期', noTrades: '暂无模拟交易', noPositions: '暂无持仓',
      welcome: '在真实 GMGN 行情中练习 Meme 交易', startingBalance: '初始虚拟余额',
      startPaperTrading: '开始模拟交易', paperOnly: '无需钱包，不动真金',
      resetWarning: '此操作会永久删除本地模拟交易和持仓。',
      resetConfirm: '确认重置全部模拟交易数据？', dataImported: '数据导入成功', importFailed: '备份文件无效',
      share: '分享', downloadPng: '下载 PNG', copyImage: '复制图片', simulatedTrade: '模拟交易 · 无真实资金',
      gmgnOnly: '请打开 GMGN Solana 代币页面进行模拟交易。', auto: '自动', chinese: '简体中文', english: 'English',
      safe: '安全', advanced: '高级', closed: '关闭', totalBuy: '总买入', totalSell: '总卖出',
      totalProfit: '总利润', paperBalance: '虚拟余额', totalAssets: '资产总额', breakeven: '一键回本',
      breakevenUnavailable: '当前持仓价值不足以收回剩余成本', pressEnter: '按 Enter 确认',
      editPresets: '编辑预设档位', savePresets: '保存预设档位', presetsSaved: '预设档位已保存',
      invalidPresets: '请输入 8 个有效的预设数值',
      skipConfirmSession: '本次浏览器会话不再提示（重启浏览器后恢复）', enabled: '启用全部功能',
      disabled: 'Tango 全部功能已关闭', setup: '设置模拟账户', setupHint: '请在这里选择语言和初始虚拟本金。',
      customBalance: '自定义本金', buySuccess: '模拟买入成功', sellSuccess: '模拟卖出成功',
      sound: '交易提示音', setupInPopup: '请点击浏览器工具栏中的 Tango 扩展完成首次设置。',
      accountSettings: '语言与虚拟本金', resetWithBalance: '按此本金重置账户',
      resetBalanceConfirm: '确定重置虚拟账户并删除所有交易记录吗？', openDashboardFailed: '无法打开数据面板',
      dragToMove: '拖拽移动', openToken: '在 GMGN 打开此代币', clickForPositions: '点击查看持仓',
      quoteLoading: '行情正在更新，请稍后重试。',
      lastKnownPrice: '当前页面无法读取该代币的 GMGN 实时价格；卖出将按最近记录价格模拟成交。'
    }
  };

  function resolveLanguage(setting) {
    if (setting === 'en' || setting === 'zh-CN') return setting;
    const browserLanguage = (global.navigator && global.navigator.language) || 'en';
    return browserLanguage.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
  }

  Tango.I18n = {
    messages,
    resolveLanguage,
    t(key, setting, vars) {
      const language = resolveLanguage(setting);
      let text = messages[language][key] || messages.en[key] || key;
      Object.entries(vars || {}).forEach(([name, value]) => {
        text = text.replaceAll(`{${name}}`, String(value));
      });
      return text;
    }
  };
})(globalThis);

import { Messages, LanguageSettings } from './types';

// 默认语言设置
const defaultLanguage = 'en';

// 多语言支持
const messages: Messages = {
  en: {
    welcome: "Aril's Pocket LP Master v2 is here!\n" +
        "Hot pool snipe, LP portfolio mgmt, smart exit— now support to ANY Solana wallet address (we never custody your funds)\n" +
        "\n" +
        "Now live on Raydium, and Meteora / Orca coming soon.\n" +
        "\n" +
        "👉 x.com/arilLPmaster",
    help: 'Here are the available commands:',
    topPools: 'Top liquidity pools information',
    lpPortfolio: 'Your LP portfolio details',
    wallet: 'Your wallet information',
    referral: 'Referral program information',
    language: 'Change language',
    languageChanged: 'Language changed to English',
    commandMenu: 'Command Menu',
    pools: {
      fetching: 'Fetching top pools data...',
      fetchError: 'Error fetching pool data. Please try again later.',
      noPoolsFound: 'No pools found matching the criteria.'
    },
    walletSettings: {
      noWallet: 'Please set up a wallet address to monitor.',
      currentWallet: 'Your current wallet address: ',
      setupButton: 'Setup Wallet Address',
      enterAddress: 'Please enter your Solana wallet address (Public Key):',
      invalidAddress: 'Invalid Solana address format. Please try again.',
      setupSuccess: 'Wallet address has been successfully set up!',
      setupFailed: 'Failed to set up wallet address. Please try again later.',
      setupTimeout: 'Setup timed out. Please try again.',
      tooManyAttempts: 'Too many invalid attempts. Please try again later.'
    },
    lpPortfolioMessages: {
      userIdError: 'Unable to recognize user ID',
      noUserFound: 'User information not found, please set up a wallet address first',
      noPositions: 'You currently have no LP positions',
      loading: 'Loading your LP portfolio...',
      portfolioTitle: 'LP Portfolio',
      totalValue: 'Total Value',
      position: 'Position',
      amount: 'Amount',
      value: 'Value',
      unclaimedFees: 'Unclaimed Fees',
      status: 'Status',
      inRange: 'In Range',
      outOfRange: 'Out of Range',
      takeProfit: 'Take Profit',
      stopLoss: 'Stop Loss',
      target: 'Target',
      initialValue: 'Initial Value',
      pnl: 'P&L',
      error: 'Error getting LP portfolio information, please try again later',
      // 添加以下消息
      enterTakeProfitValue: 'Please enter Take Profit target value (current value: ${0}):',
      enterStopLossValue: 'Please enter Stop Loss target value (current value: ${0}):',
      takeProfitValueTooLow: 'Take Profit target value must be greater than current value ${0}, please re-enter:',
      stopLossValueTooHigh: 'Stop Loss target value must be less than current value ${0}, please re-enter:',
      takeProfitSet: 'Take Profit has been set to ${0}% (target value: ${1})',
      stopLossSet: 'Stop Loss has been set to ${0}% (target value: ${1})',
    },
    profitLossSettings: {
      setDefaultButton: 'Set Default Take Profit/Stop Loss',
      setTakeProfitButton: 'Set Take Profit',
      setStopLossButton: 'Set Stop Loss',
      enterTakeProfit: 'Please enter your default take profit percentage (e.g. 50 for 50%):',
      enterStopLoss: 'Please enter your default stop loss percentage (e.g. 20 for 20%):',
      invalidPercentage: 'Invalid percentage. Please enter a number between 1 and 100.',
      takeProfitSuccess: 'Default take profit has been set to {0}%',
      stopLossSuccess: 'Default stop loss has been set to {0}%',
      setupFailed: 'Failed to set up. Please try again later.',
      setupTimeout: 'Setup timed out. Please try again.',
      tooManyAttempts: 'Too many invalid attempts. Please try again later.',
      noUserRegistered: 'Please register your public key in wallet settings first and make sure you have LP positions',
      currentSettings: 'Your current take profit/stop loss settings:',
      noSettings: 'You have no take profit/stop loss settings. Please set them up below:',
      timeout: 'Setting timeout. Please try again.',
    }
  },
  zh: {
    welcome: "Aril 口袋LP大师 v2 上线！\n" +
        "热门池狙击、LP投资组合管理、智能退出 —— 适配任意 Solana 钱包（bot不托管资金）。\n" +
        "\n" +
        "现已支持 Raydium，Meteora / Orca 即将上线。\n" +
        "\n" +
        "👉 x.com/arilLPmaster",
    help: '以下是可用的命令：',
    topPools: '顶级流动性池信息',
    lpPortfolio: '您的LP投资组合详情',
    wallet: '您的钱包信息',
    referral: '推荐计划信息',
    language: '更改语言',
    languageChanged: '语言已更改为中文',
    commandMenu: '命令菜单',
    pools: {
      fetching: '正在获取顶级池数据...',
      fetchError: '获取池数据时出错。请稍后再试。',
      noPoolsFound: '没有找到符合条件的池。'
    },
    walletSettings: {
      noWallet: '请设置您想要监控的钱包地址。',
      currentWallet: '您当前的钱包地址：',
      setupButton: '设置钱包地址',
      enterAddress: '请输入您的Solana钱包地址（公钥）：',
      invalidAddress: 'Solana地址格式无效。请重试。',
      setupSuccess: '钱包地址已成功设置！',
      setupFailed: '设置钱包地址失败。请稍后再试。',
      setupTimeout: '设置超时。请重试。',
      tooManyAttempts: '无效尝试次数过多。请稍后再试。'
    },
    lpPortfolioMessages: {
      userIdError: '无法识别用户ID',
      noUserFound: '未找到用户信息，请先设置钱包地址',
      noPositions: '您目前没有LP仓位',
      loading: '正在加载您的LP投资组合...',
      portfolioTitle: 'LP投资组合',
      totalValue: '总价值',
      position: '仓位',
      amount: '数量',
      value: '价值',
      unclaimedFees: '未领取费用',
      status: '状态',
      inRange: '在范围内',
      outOfRange: '超出范围',
      takeProfit: '止盈',
      stopLoss: '止损',
      target: '目标',
      initialValue: '初始价值',
      pnl: '盈亏',
      error: '获取LP投资组合信息时出错，请稍后再试'
    },
    profitLossSettings: {
      setDefaultButton: '设置默认止盈/止损',
      setTakeProfitButton: '设置止盈',
      setStopLossButton: '设置止损',
      enterTakeProfit: '请输入您的默认止盈百分比（例如：输入50表示50%）：',
      enterStopLoss: '请输入您的默认止损百分比（例如：输入20表示20%）：',
      invalidPercentage: '百分比无效。请输入1到100之间的数字。',
      takeProfitSuccess: '默认止盈已设置为{0}%',
      stopLossSuccess: '默认止损已设置为{0}%',
      setupFailed: '设置失败。请稍后再试。',
      setupTimeout: '设置超时。请重试。',
      tooManyAttempts: '无效尝试次数过多。请稍后再试。',
      noUserRegistered: '请先在钱包设置中注册您的公钥，并确保您有LP仓位',
      currentSettings: '您当前的止盈/止损设置：',
      noSettings: '您还没有设置止盈/止损。请在下方设置：',
      timeout: '设置超时，请重新开始。',
      enterTakeProfitValue: '请输入Take Profit目标价值（当前价值: ${0}）：',
      enterStopLossValue: '请输入Stop Loss目标价值（当前价值: ${0}）：',
      takeProfitValueTooLow: 'Take Profit目标价值必须大于当前价值 ${0}，请重新输入：',
      stopLossValueTooHigh: 'Stop Loss目标价值必须小于当前价值 ${0}，请重新输入：',
      takeProfitSet: 'Take Profit已设置为${0}%（目标价值: ${1}）',
      stopLossSet: 'Stop Loss已设置为${0}%（目标价值: ${1}）',
      // ... existing code ...
    }
  }
};

// 获取当前语言的消息
const getMessage = (key: string, lang = defaultLanguage): string => {
  // 处理嵌套消息，如 'pools.fetching'
  if (key.includes('.')) {
    const [category, subKey] = key.split('.');
    return messages[lang]?.[category]?.[subKey] || messages[defaultLanguage][category][subKey];
  }
  return messages[lang]?.[key] || messages[defaultLanguage][key];
};

// 导出语言设置
export const languageSettings: LanguageSettings = {
  defaultLanguage,
  messages,
  getMessage
};
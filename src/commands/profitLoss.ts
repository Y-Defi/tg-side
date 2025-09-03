import { CommandHandler, MyContext } from '../types';
import { Markup } from 'telegraf';
import { User } from '../models/User';
import { languageSettings } from '../i18n';

// 验证百分比格式
const isValidPercentage = (percentage: string): boolean => {
  const num = parseFloat(percentage);
  return !isNaN(num) && num > 0 && num <= 100;
};

// 处理设置止盈按钮回调
const handleTakeProfitSetup = async (ctx: MyContext): Promise<void> => {
  // 初始化session中的尝试次数
  ctx.session.settingsInputAttempts = 0;
  
  // 设置等待输入状态
  ctx.session.waitingForTakeProfit = true;
  ctx.session.waitingForStopLoss = false; // 确保另一个状态被重置
  ctx.session.sessionStartTime = Date.now();
  
  const lang = ctx.session?.language || 'en';
  // 提示用户输入百分比
  await ctx.reply(lang === 'zh' ? 
    '请输入您的默认止盈百分比（例如：输入50表示50%）：' : 
    'Please enter your default take profit percentage (e.g. 50 for 50%):');
};

// 处理设置止损按钮回调
const handleStopLossSetup = async (ctx: MyContext): Promise<void> => {
  // 初始化session中的尝试次数
  ctx.session.settingsInputAttempts = 0;
  
  // 设置等待输入状态
  ctx.session.waitingForStopLoss = true;
  ctx.session.waitingForTakeProfit = false; // 确保另一个状态被重置
  ctx.session.sessionStartTime = Date.now();
  
  const lang = ctx.session?.language || 'en';
  // 提示用户输入百分比
  await ctx.reply(lang === 'zh' ? 
    '请输入您的默认止损百分比（例如：输入20表示20%）：' : 
    'Please enter your default stop loss percentage (e.g. 20 for 20%):');
};

// 检查是否超时
export const checkTimeout = (ctx: MyContext, getMessage): boolean => {
  const currentTime = Date.now();
  const startTime = ctx.session.sessionStartTime || 0;
  const lang = ctx.session?.language || 'en';
  
  if (currentTime - startTime > 30000) { // 30秒超时
    ctx.session.waitingForTakeProfit = false;
    ctx.session.waitingForStopLoss = false;
    ctx.reply(getMessage('profitLossSettings.setupTimeout', lang));
    return true;
  }
  return false;
};

// 处理用户输入的止盈百分比
export const handleTakeProfitInput = async (ctx: MyContext, percentage: string, getMessage): Promise<void> => {
  const lang = ctx.session?.language || 'en';
  
  // 重置等待状态
  ctx.session.waitingForTakeProfit = false;
  
  // 验证百分比格式
  if (!isValidPercentage(percentage)) {
    // 增加尝试次数
    ctx.session.settingsInputAttempts = (ctx.session.settingsInputAttempts || 0) + 1;
    
    // 检查是否超过最大尝试次数
    if (ctx.session.settingsInputAttempts >= 2) {
      await ctx.reply(getMessage('profitLossSettings.tooManyAttempts', lang));
      return;
    }
    
    // 提示百分比无效并重新等待输入
    await ctx.reply(getMessage('profitLossSettings.invalidPercentage', lang));
    ctx.session.waitingForTakeProfit = true;
    ctx.session.sessionStartTime = Date.now();
    return;
  }
  
  try {
    // 获取用户Telegram ID
    const telegramId = ctx.from?.id;
    if (!telegramId) {
      await ctx.reply(getMessage('profitLossSettings.setupFailed', lang));
      return;
    }
    
    // 查找用户记录
    let user = await User.findOne({ telegramId });
    
    if (user) {
      // 更新现有用户的默认止盈百分比
      user.defaultTakeProfit = parseFloat(percentage);
      await user.save();
      
      // 发送成功消息 - 修改这里，使用 {0} 而不是 {percentage}
      await ctx.reply(getMessage('profitLossSettings.takeProfitSuccess', lang).replace('{0}', percentage));
    } else {
      // 用户不存在，返回提示信息
      await ctx.reply(getMessage('profitLossSettings.noUserRegistered', lang));
    }
  } catch (error) {
    console.error('保存默认止盈百分比时出错:', error);
    await ctx.reply(getMessage('profitLossSettings.setupFailed', lang));
  }
};

// 处理用户输入的止损百分比
export const handleStopLossInput = async (ctx: MyContext, percentage: string, getMessage): Promise<void> => {
  const lang = ctx.session?.language || 'en';
  
  // 重置等待状态
  ctx.session.waitingForStopLoss = false;
  
  // 验证百分比格式
  if (!isValidPercentage(percentage)) {
    // 增加尝试次数
    ctx.session.settingsInputAttempts = (ctx.session.settingsInputAttempts || 0) + 1;
    
    // 检查是否超过最大尝试次数
    if (ctx.session.settingsInputAttempts >= 2) {
      await ctx.reply(getMessage('profitLossSettings.tooManyAttempts', lang));
      return;
    }
    
    // 提示百分比无效并重新等待输入
    await ctx.reply(getMessage('profitLossSettings.invalidPercentage', lang));
    ctx.session.waitingForStopLoss = true;
    ctx.session.sessionStartTime = Date.now();
    return;
  }
  
  try {
    // 获取用户Telegram ID
    const telegramId = ctx.from?.id;
    if (!telegramId) {
      await ctx.reply(getMessage('profitLossSettings.setupFailed', lang));
      return;
    }
    
    // 查找用户记录
    let user = await User.findOne({ telegramId });
    
    if (user) {
      // 更新现有用户的默认止损百分比
      user.defaultStopLoss = parseFloat(percentage);
      await user.save();
      
      // 发送成功消息 - 修改这里，使用 {0} 而不是 {percentage}
      await ctx.reply(getMessage('profitLossSettings.stopLossSuccess', lang).replace('{0}', percentage));
    } else {
      // 用户不存在，返回提示信息
      await ctx.reply(getMessage('profitLossSettings.noUserRegistered', lang));
    }
  } catch (error) {
    console.error('保存默认止损百分比时出错:', error);
    await ctx.reply(getMessage('profitLossSettings.setupFailed', lang));
  }
};

const profitLossCommand: CommandHandler = {
  command: 'profitloss',
  description: 'Set default take profit and stop loss',
  handler: async (ctx: MyContext, getMessage) => {
    try {
      const lang = ctx.session?.language || 'en';
      
      // 获取用户信息
      const telegramId = ctx.from?.id;
      if (!telegramId) {
        await ctx.reply(getMessage('profitLossSettings.setupFailed', lang));
        return;
      }
      
      const user = await User.findOne({ telegramId });
      
      // 准备回复消息和按钮
      let message = '';
      if (user) {
        message = getMessage('profitLossSettings.currentSettings', lang);
        if (user.defaultTakeProfit !== undefined) {
          message += `\n${getMessage('lpPortfolioMessages.takeProfit', lang)}: ${user.defaultTakeProfit}%`;
        }
        if (user.defaultStopLoss !== undefined) {
          message += `\n${getMessage('lpPortfolioMessages.stopLoss', lang)}: ${user.defaultStopLoss}%`;
        }
      } else {
        message = getMessage('profitLossSettings.noSettings', lang);
      }
      
      // 添加设置按钮
      await ctx.reply(message, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...Markup.inlineKeyboard([
          Markup.button.callback(getMessage('profitLossSettings.setTakeProfitButton', lang), 'setup_takeprofit'),
          Markup.button.callback(getMessage('profitLossSettings.setStopLossButton', lang), 'setup_stoploss')
        ])
      });
    } catch (error) {
      console.error('获取止盈止损信息时出错:', error);
      const lang = ctx.session?.language || 'en';
      await ctx.reply(getMessage('profitLossSettings.setupFailed', lang));
    }
  }
};

// 导出命令和回调处理函数
export const handleProfitLossCallbacks = (bot: any) => {
  bot.action('setup_takeprofit', async (ctx: MyContext) => {
    await ctx.answerCbQuery();
    await handleTakeProfitSetup(ctx);
  });
  
  bot.action('setup_stoploss', async (ctx: MyContext) => {
    await ctx.answerCbQuery();
    await handleStopLossSetup(ctx);
  });
  
  
};

export default profitLossCommand;
import { Telegraf, Markup, session } from 'telegraf';
import dotenv from 'dotenv';
import { commands, handleLanguageCallbacks, handleWalletCallbacks, handleProfitLossCallbacks, handleMeteoraeTakeProfitButton, handleMeteoraStopLossButton, handleMeteoraPositionSettingInput, handleOrcaTakeProfitButton, handleOrcaStopLossButton, handleOrcaPositionSettingInput } from './commands';
import { languageSettings } from './i18n';
import { MyContext } from './types';
import mongoose from 'mongoose';
import { updateAllTokens } from './services/tokenService';
import { RaydiumService } from './services/raydiumService';
import { MeteoraService } from './services/meteoraService';
import { OrcaService } from './services/orcaService';
import { FetchPoolService } from './services/fetchPoolService';
// 导入处理函数
import { handlePublicKeyInput } from './commands/wallet';
import { handleTakeProfitInput, handleStopLossInput, checkTimeout } from './commands/profitLoss';
import { handleTakeProfitButton, handleStopLossButton, handlePositionSettingInput } from './commands/lpPortfolio';

// 加载环境变量
dotenv.config();
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/tg_bot';

mongoose.connect(MONGODB_URI)
    .then(() => {
        console.log('Connected to MongoDB');
    })
    .catch((err) => {
        console.error('MongoDB connection error:', err);
        process.exit(1);
    });

// 检查是否有Telegram Bot Token
if (!process.env.BOT_TOKEN) {
  console.error('错误: 请在.env文件中设置BOT_TOKEN环境变量');
  process.exit(1);
}

// 创建机器人实例
const bot = new Telegraf<MyContext>(process.env.BOT_TOKEN);

// 使用session中间件
bot.use(session({
  defaultSession: () => ({
    language: 'en',
    referralCode: ''
  })
}));



// 注册所有命令
commands.forEach(cmd => {
  bot.command(cmd.command, (ctx) => cmd.handler(ctx, languageSettings.getMessage));
});

bot.action(/^tp_.*$/, (ctx) => handleTakeProfitButton(ctx));
bot.action(/^sl_.*$/, (ctx) => handleStopLossButton(ctx));
bot.action(/^tp_meteora_.*$/, (ctx) => handleMeteoraeTakeProfitButton(ctx));
bot.action(/^sl_meteora_.*$/, (ctx) => handleMeteoraStopLossButton(ctx));
bot.action(/^orca_tp_.*$/, (ctx) => handleOrcaTakeProfitButton(ctx));
bot.action(/^orca_sl_.*$/, (ctx) => handleOrcaStopLossButton(ctx));

// 注册语言选择回调
handleLanguageCallbacks(bot);
handleWalletCallbacks(bot);
handleProfitLossCallbacks(bot);

// 添加统一的文本处理器
bot.on('text', async (ctx: MyContext) => {
  const getMessage = languageSettings.getMessage;
  const lang = ctx.session?.language || 'en';

  // 处理钱包地址输入
  if (ctx.session.waitingForToken) {
    // 检查是否超时
    const currentTime = Date.now();
    const startTime = ctx.session.sessionStartTime || 0;

    if (currentTime - startTime > 30000) { // 30秒超时
      ctx.session.waitingForToken = false;
      await ctx.reply(lang === 'zh' ?
        '设置超时。请重试。' :
        'Setup timed out. Please try again.');
      return;
    }

    await handlePublicKeyInput(ctx, ctx.message.text);
    return;
  }

  // 处理止盈止损输入（profitLoss.ts中的函数）
  if (ctx.session.waitingForTakeProfit|| ctx.session.waitingForStopLoss ) {
      // 检查是否超时
      if (checkTimeout(ctx, getMessage)) {
        return;
      }

      if (ctx.session.waitingForTakeProfit) {
        await handleTakeProfitInput(ctx, ctx.message.text, getMessage);
      } else if (ctx.session.waitingForStopLoss) {
        await handleStopLossInput(ctx, ctx.message.text, getMessage);
      }
      return;
  }

  // 处理LP仓位的止盈止损输入（lpPortfolio.ts中的函数）
  if (ctx.session.waitingForTakeProfitValue && ctx.session.editingPosition ||
      ctx.session.waitingForStopLossValue && ctx.session.editingPosition) {

      // 检查是否是meteora position
      if (ctx.session.editingPosition?.source === 'meteora') {
        await handleMeteoraPositionSettingInput(ctx, getMessage);
      } else {
        await handlePositionSettingInput(ctx, getMessage);
      }
      return;
  }

  // 处理Orca LP仓位的止盈止损输入
  if (ctx.session.waitingForOrcaTakeProfitValue || ctx.session.waitingForOrcaStopLossValue) {
      await handleOrcaPositionSettingInput(ctx, getMessage);
      return;
  }
});

// 设置定时任务更新所有代币信息
const tokenUpdateInterval = setInterval(updateAllTokens, 5 * 60 * 1000);

// 设置定时任务更新所有池信息
const poolUpdateInterval = setInterval(() => {
  FetchPoolService.updateAllPools()
    .then(() => console.log('Scheduled pool update completed'))
    .catch(err => console.error('Scheduled pool update failed:', err));
}, 5 * 60 * 1000);

// 启动全局position更新任务
RaydiumService.startGlobalPositionUpdateTask();
MeteoraService.startGlobalPositionUpdateTask();
OrcaService.startGlobalPositionUpdateTask();

// 设置命令菜单
bot.telegram.setMyCommands(
  commands.map(cmd => ({
    command: cmd.command,
    description: cmd.description
  }))
);

// 启动机器人
bot.launch()
  .then(() => {
    console.log('机器人已启动');
    // 初始化时立即更新一次池信息
    FetchPoolService.updateAllPools()
      .then(() => console.log('Initial pool update completed'))
      .catch(err => console.error('Initial pool update failed:', err));
  })
  .catch((err) => {
    console.error('启动机器人时出错:', err);
  });

// 优雅地处理退出
process.once('SIGINT', () => {
  console.log('正在停止机器人和清理资源...');
  // 停止Telegram机器人
  bot.stop('SIGINT');
  // 停止全局position更新任务
  RaydiumService.stopGlobalPositionUpdateTask();
  MeteoraService.stopGlobalPositionUpdateTask();
  OrcaService.stopGlobalPositionUpdateTask();
  // 清除代币更新的定时器
  clearInterval(tokenUpdateInterval);
  // 清除池更新的定时器
  clearInterval(poolUpdateInterval);
  console.log('所有资源已清理完毕');
});

process.once('SIGTERM', () => {
  console.log('正在停止机器人和清理资源...');
  // 停止Telegram机器人
  bot.stop('SIGTERM');
  // 停止全局position更新任务
  RaydiumService.stopGlobalPositionUpdateTask();
  MeteoraService.stopGlobalPositionUpdateTask();
  OrcaService.stopGlobalPositionUpdateTask();
  // 清除代币更新的定时器
  clearInterval(tokenUpdateInterval);
  // 清除池更新的定时器
  clearInterval(poolUpdateInterval);
  console.log('所有资源已清理完毕');
});



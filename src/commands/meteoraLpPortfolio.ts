import { CommandHandler, MyContext } from '../types';
import { User } from '../models/User';
import { MeteoraService } from '../services/meteoraService';
import { Markup } from 'telegraf';
import { languageSettings } from '../i18n';

// 格式化数字显示
function formatNumber(num: string | number): string {
  const value = typeof num === 'string' ? parseFloat(num) : num;
  if (isNaN(value)) return '0';
  
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(2)}K`;
  return value.toFixed(2);
}

// 格式化费用值
function formatFeesValue(value: number): string {
  if (value < 0.01 && value > 0) return '<$0.01';
  return `$${formatNumber(value)}`;
}

// 计算position的总价值
async function calculatePositionValue(position: any): Promise<number> {
  // 从position中获取代币A和代币B的价值
  const tokenAValue = position.tokenAValue ? parseFloat(position.tokenAValue) : 0;
  const tokenBValue = position.tokenBValue ? parseFloat(position.tokenBValue) : 0;
  
  // 计算所有rewards的价值总和
  const rewardsValue = position.rewardsInfos.reduce((total: number, reward: any) => {
    const tokenValue = reward.tokenValue ? parseFloat(reward.tokenValue) : 0;
    return total + tokenValue;
  }, 0);
  
  // 返回总价值（代币A + 代币B + 所有rewards）
  return tokenAValue + tokenBValue + rewardsValue;
}

// 格式化position信息
async function formatPositionInfo(position: any, index: number, lang: string, telegramId: number, getMessage: Function) {
  // 检查position是否有必要的信息
  if (!position || !position.displayInfo) return '';
  
  // 从displayInfo中获取代币信息
  const poolParts = position.displayInfo.pool.split(' - ');
  const tokenASymbol = poolParts[0].replace(/WSOL/gi, 'SOL');
  const tokenBSymbol = poolParts[1].replace(/WSOL/gi, 'SOL');
  
  // 计算position价值
  const positionValue = await calculatePositionValue(position);

  const tokenAValue = position.tokenAValue ? parseFloat(position.tokenAValue) : 0;
  const tokenBValue = position.tokenBValue ? parseFloat(position.tokenBValue) : 0;
  const tokensValue = tokenAValue + tokenBValue;
  
  // 计算未领取的费用价值
  const unclaimedFeesValue = position.rewardsInfos
    .reduce((total: number, reward: any) => {
      const tokenValue = reward.tokenValue ? parseFloat(reward.tokenValue) : 0;
      return total + tokenValue;
    }, 0);
  
  // 判断是否在价格范围内（对于Meteora，我们简化这个判断）
  const isInRange = parseFloat(position.displayInfo.pooledAmountA) > 0 && 
                   parseFloat(position.displayInfo.pooledAmountB) > 0;
  
  // 构建DexScreener链接
  const poolAddress = position.poolId;
  const dexScreenerLink = `https://dexscreener.com/solana/${poolAddress}`;
  
  // 构建止盈止损信息
  let tpslInfo = '';
  const user = await User.findOne({ telegramId: telegramId });
  if (user && user.lpPositions) {
    const positionSettings = user.lpPositions.get(position.displayInfo.nft);
    if (positionSettings) {
      // 添加初始价值信息
      const initialValueText = getMessage('lpPortfolioMessages.initialValue', lang);
      tpslInfo += `💲 ${initialValueText}: $${formatNumber(positionSettings.initialValue)}\n`;
      
      // 计算并添加盈亏信息
      const pnlText = getMessage('lpPortfolioMessages.pnl', lang);
      const pnlValue = positionValue - positionSettings.initialValue;
      const pnlPercentage = (pnlValue / positionSettings.initialValue) * 100;
      const pnlSign = pnlValue >= 0 ? '+' : '';
      tpslInfo += `📈 ${pnlText}: ${pnlSign}$${formatNumber(pnlValue)} (${pnlSign}${pnlPercentage.toFixed(2)}%)\n`;
      
      if (positionSettings.takeProfit) {
        const takeProfitText = getMessage('lpPortfolioMessages.takeProfit', lang);
        const targetText = getMessage('lpPortfolioMessages.target', lang);
        tpslInfo += `🔼 ${takeProfitText}: ${positionSettings.takeProfit.percentage}% (${targetText}: $${formatNumber(positionSettings.takeProfit.targetValue)})`;
      }
      if (positionSettings.stopLoss) {
        if (positionSettings.takeProfit) tpslInfo += '\n';
        const stopLossText = getMessage('lpPortfolioMessages.stopLoss', lang);
        const targetText = getMessage('lpPortfolioMessages.target', lang);
        tpslInfo += `🔽 ${stopLossText}: ${positionSettings.stopLoss.percentage}% (${targetText}: $${formatNumber(positionSettings.stopLoss.targetValue)})`;
      }
    }
  }
  
  // 获取文本
  const positionText = getMessage('lpPortfolioMessages.position', lang);
  const amountText = getMessage('lpPortfolioMessages.amount', lang);
  const valueText = getMessage('lpPortfolioMessages.value', lang);
  const unclaimedFeesText = getMessage('lpPortfolioMessages.unclaimedFees', lang);
  const statusText = getMessage('lpPortfolioMessages.status', lang);
  const inRangeText = getMessage('lpPortfolioMessages.inRange', lang);
  const outOfRangeText = getMessage('lpPortfolioMessages.outOfRange', lang);
  
  // 构建position信息文本
  return `🌊 <b>Meteora ${positionText} #${index}</b> ${tokenASymbol}/${tokenBSymbol}\n` +
         `💰 ${amountText}: ${formatNumber(position.displayInfo.pooledAmountA)} ${tokenASymbol} / ${formatNumber(position.displayInfo.pooledAmountB)} ${tokenBSymbol} ($${formatNumber(tokensValue)})\n` +
         `💸 ${unclaimedFeesText}: ${position.rewardsInfos.map((r: any) => `${formatNumber(r.amount)} ${r.mint}`).join(' / ')} ($${formatNumber(unclaimedFeesValue)})\n` +
         `💵 ${valueText}: $${formatNumber(positionValue)}\n` +
         `📊 ${statusText}: ${isInRange ? `✅ ${inRangeText}` : `❌ ${outOfRangeText}`}\n` +
         `${tpslInfo ? tpslInfo + '\n' : ''}`;
}

const meteoraLpPortfolioCommand: CommandHandler = {
  command: 'meteora_lp_portfolio',
  description: 'Show your Meteora LP portfolio',
  handler: async (ctx: MyContext, getMessage) => {
    try {
      const telegramId = ctx.from?.id;
      if (!telegramId) {
        return ctx.reply(getMessage('lpPortfolioMessages.userIdError', ctx.session?.language || 'en'));
      }
      
      // 查找用户
      const user = await User.findOne({ telegramId });
      if (!user) {
        return ctx.reply(getMessage('lpPortfolioMessages.noUserFound', ctx.session?.language || 'en'));
      }
      
      // 获取用户的Meteora positions信息
      const result = await MeteoraService.getUserPositions(telegramId);
      if (!result.positions || result.positions.length === 0) {
        return ctx.reply(getMessage('lpPortfolioMessages.noPositions', ctx.session?.language || 'en'));
      }
      
      // 获取用户语言设置
      const lang = ctx.session?.language || 'en'; // 默认使用英文
      // 发送加载消息
      const loadingMsg = await ctx.reply(getMessage('lpPortfolioMessages.loading', lang));
      
      // 格式化每个position的信息
      const positionsInfo = await Promise.all(
        result.positions.map((position, index) => 
          formatPositionInfo(position, index + 1, lang, telegramId, getMessage)
        )
      );
      
      // 计算总价值
      const totalValue = await result.positions.reduce(async (promisedTotal, position) => {
        const total = await promisedTotal;
        const value = await calculatePositionValue(position);
        return total + value;
      }, Promise.resolve(0));
      
      // 获取文本
      const portfolioTitle = `Meteora ${getMessage('lpPortfolioMessages.portfolioTitle', lang)}`;
      const totalValueText = getMessage('lpPortfolioMessages.totalValue', lang);
      
      // 构建完整的投资组合信息
      const portfolioInfo = `🌊 <b>${portfolioTitle}</b>\n\n` +
                           `💰 ${totalValueText}: $${formatNumber(totalValue)}\n\n` +
                           `${positionsInfo.filter(Boolean).join('\n\n')}`;
      
      // 创建按钮
      const inlineKeyboard = [];
      
      // 为每个position创建Take Profit和Stop Loss按钮
      result.positions.forEach((position, index) => {
        if (position && position.displayInfo) {
          const nftMint = position.displayInfo.nft;
          inlineKeyboard.push([
            Markup.button.callback(
              `💹 Take Profit #${index + 1}`, 
              `tp_meteora_${nftMint}`
            ),
            Markup.button.callback(
              `📉 Stop Loss #${index + 1}`, 
              `sl_meteora_${nftMint}`
            )
          ]);
        }
      });
      
      // 发送投资组合信息和按钮
      await ctx.telegram.editMessageText(
        ctx.chat?.id,
        loadingMsg.message_id,
        undefined,
        portfolioInfo,
        { 
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard(inlineKeyboard)
        }
      );
      
    } catch (error) {
      console.error('Error in meteoraLpPortfolio command:', error);
      const lang = ctx.session?.language || 'en';
      ctx.reply(getMessage('lpPortfolioMessages.error', lang));
    }
  }
};

// 处理Meteora Take Profit按钮点击
async function handleMeteoraeTakeProfitButton(ctx: MyContext) {
  try {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;
    
    const callbackData = ctx.callbackQuery?.data;
    if (!callbackData) return;
    
    const nftMint = callbackData.replace('tp_meteora_', '');
    
    // 设置会话状态，标记正在编辑的position
    ctx.session.editingPosition = {
      type: 'takeProfit',
      nftMint: nftMint,
      source: 'meteora'
    };
    ctx.session.waitingForTakeProfitValue = true;
    ctx.session.positionSettingAttempts = 0;
    // 使用统一的sessionStartTime
    ctx.session.sessionStartTime = Date.now();
    
    const lang = ctx.session?.language || 'en';
    
    // 获取position的当前价值
    const user = await User.findOne({ telegramId });
    if (!user) return;
    
    const result = await MeteoraService.getUserPositions(telegramId);
    if (!result.positions) return;
    
    const position = result.positions.find(p => p.displayInfo.nft === nftMint);
    if (!position) return;
    
    const positionValue = await calculatePositionValue(position);
    
    // 回复用户，请求输入Take Profit目标价值
    await ctx.answerCbQuery();
    await ctx.reply(languageSettings.getMessage('lpPortfolioMessages.enterTakeProfitValue', lang).replace('${0}', `$${formatNumber(positionValue)}`));
    
  } catch (error) {
    console.error('Error handling Meteora Take Profit button:', error);
  }
}

// 处理Meteora Stop Loss按钮点击
async function handleMeteoraStopLossButton(ctx: MyContext) {
  try {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;
    
    const callbackData = ctx.callbackQuery?.data;
    if (!callbackData) return;
    
    const nftMint = callbackData.replace('sl_meteora_', '');
    
    // 设置会话状态，标记正在编辑的position
    ctx.session.editingPosition = {
      type: 'stopLoss',
      nftMint: nftMint,
      source: 'meteora'
    };
    ctx.session.waitingForStopLossValue = true;
    ctx.session.positionSettingAttempts = 0;
    // 使用统一的sessionStartTime
    ctx.session.sessionStartTime = Date.now();
    
    const lang = ctx.session?.language || 'en';
    
    // 获取position的当前价值
    const user = await User.findOne({ telegramId });
    if (!user) return;
    
    const result = await MeteoraService.getUserPositions(telegramId);
    if (!result.positions) return;
    
    const position = result.positions.find(p => p.displayInfo.nft === nftMint);
    if (!position) return;
    
    const positionValue = await calculatePositionValue(position);
    
    // 回复用户，请求输入Stop Loss目标价值
    await ctx.answerCbQuery();
    await ctx.reply(languageSettings.getMessage('lpPortfolioMessages.enterStopLossValue', lang).replace('${0}', `$${formatNumber(positionValue)}`));
    
  } catch (error) {
    console.error('Error handling Meteora Stop Loss button:', error);
  }
}

// 处理用户输入的Meteora Take Profit或Stop Loss值
async function handleMeteoraPositionSettingInput(ctx: MyContext, getMessage: Function) {
  try {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;
    
    const lang = ctx.session?.language || 'en';
    
    // 检查是否是Meteora position设置
    if (!ctx.session.editingPosition || ctx.session.editingPosition.source !== 'meteora') return;
    
    // 检查是否在等待Take Profit或Stop Loss输入
    if (!ctx.session.waitingForTakeProfitValue && !ctx.session.waitingForStopLossValue) return;
    
    // 检查是否超时（30秒）
    const currentTime = Date.now();
    const startTime = ctx.session.sessionStartTime || 0;
    if (currentTime - startTime > 30000) { // 30秒超时
      ctx.session.waitingForTakeProfitValue = false;
      ctx.session.waitingForStopLossValue = false;
      ctx.session.editingPosition = undefined;
      return ctx.reply(getMessage('profitLossSettings.timeout', lang) );
    }
    
    // 获取用户输入的文本
    const text = ctx.message?.text;
    if (!text) return;
    
    // 解析输入的目标价值
    let targetValue = parseFloat(text.replace(/[$,]/g, ''));
    
    // 验证输入是否为有效数字
    if (isNaN(targetValue) || targetValue <= 0) {
      ctx.session.positionSettingAttempts = (ctx.session.positionSettingAttempts || 0) + 1;
      if (ctx.session.positionSettingAttempts >= 2) { // 修改为最多重试2次
        // 超过尝试次数，取消设置
        ctx.session.waitingForTakeProfitValue = false;
        ctx.session.waitingForStopLossValue = false;
        ctx.session.editingPosition = undefined;
        return ctx.reply(getMessage('profitLossSettings.tooManyAttempts', lang));
      }
      return ctx.reply(getMessage('profitLossSettings.invalidPercentage', lang));
    }
    
    // 获取用户和position信息
    const user = await User.findOne({ telegramId });
    if (!user) return;
    
    const nftMint = ctx.session.editingPosition?.nftMint;
    if (!nftMint) return;
    
    const result = await MeteoraService.getUserPositions(telegramId);
    if (!result.positions) return;
    
    const position = result.positions.find(p => p.displayInfo.nft === nftMint);
    if (!position) return;
    
    const positionValue = await calculatePositionValue(position);
    const poolId = position.poolId;
    
    // 验证目标价值是否符合要求
    if (ctx.session.waitingForTakeProfitValue && targetValue <= positionValue) {
      return ctx.reply(getMessage('lpPortfolioMessages.takeProfitValueTooLow', lang).replace('${0}', `$${formatNumber(positionValue)}`));
    }
    
    if (ctx.session.waitingForStopLossValue && targetValue >= positionValue) {
      return ctx.reply(getMessage('lpPortfolioMessages.stopLossValueTooHigh', lang).replace('${0}', `$${formatNumber(positionValue)}`));
    }
    
    // 计算百分比
    let percentage: number;
    if (ctx.session.waitingForTakeProfitValue) {
      percentage = ((targetValue - positionValue) / positionValue) * 100;
    } else { // waitingForStopLossValue
      percentage = ((positionValue - targetValue) / positionValue) * 100;
    }
    
    // 四舍五入到两位小数
    percentage = Math.round(percentage * 100) / 100;
    
    // 获取或创建position设置
    let positionSettings = user.lpPositions.get(nftMint);
    if (!positionSettings) {
      positionSettings = {
        poolId,
        nft: nftMint,
        publicKey: user.publicKey,
        initialValue: positionValue,
        createdAt: new Date()
      };
    }
    
    // 更新Take Profit或Stop Loss设置
    if (ctx.session.waitingForTakeProfitValue) {
      positionSettings.takeProfit = {
        percentage,
        targetValue
      };
      // 重置triggeredProfit状态
      positionSettings.triggeredProfit = false;
    } else { // waitingForStopLossValue
      positionSettings.stopLoss = {
        percentage,
        targetValue
      };
      // 重置triggeredLoss状态
      positionSettings.triggeredLoss = false;
    }
    
    // 保存设置到用户的lpPositions中
    user.lpPositions.set(nftMint, positionSettings);
    await user.save();
    
    
    // 确认设置已保存
    if (ctx.session.waitingForTakeProfitValue) {
      await ctx.reply(getMessage('lpPortfolioMessages.takeProfitSet', lang)
        .replace('${0}', percentage.toString())
        .replace('${1}', `$${formatNumber(targetValue)}`));
    } else { // waitingForStopLossValue
      await ctx.reply(getMessage('lpPortfolioMessages.stopLossSet', lang)
        .replace('${0}', percentage.toString())
        .replace('${1}', `$${formatNumber(targetValue)}`));
    }

    // 重置会话状态
    ctx.session.waitingForTakeProfitValue = false;
    ctx.session.waitingForStopLossValue = false;
    ctx.session.editingPosition = undefined;
    
    // 重新显示投资组合
    await meteoraLpPortfolioCommand.handler(ctx, getMessage);
    
  } catch (error) {
    console.error('Error handling Meteora position setting input:', error);
    const lang = ctx.session?.language || 'en';
    ctx.reply(getMessage('profitLossSettings.setupFailed', lang));
  }
}

export default meteoraLpPortfolioCommand;

// 导出按钮处理函数，以便在主文件中注册
export { handleMeteoraeTakeProfitButton, handleMeteoraStopLossButton, handleMeteoraPositionSettingInput };
import { CommandHandler, MyContext } from '../types';
import { User } from '../models/User';
import { OrcaService } from '../services/orcaService';
import { Markup } from 'telegraf';
import { languageSettings } from '../i18n';

// Format number display
function formatNumber(num: string | number): string {
  const value = typeof num === 'string' ? parseFloat(num) : num;
  if (isNaN(value)) return '0';
  
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(2)}K`;
  return value.toFixed(2);
}

// Format fees value
function formatFeesValue(value: number): string {
  if (value < 0.01 && value > 0) return '<$0.01';
  return `$${formatNumber(value)}`;
}

// Calculate position total value
async function calculatePositionValue(position: any): Promise<number> {
  const tokenAValue = position.tokenAValue ? parseFloat(position.tokenAValue) : 0;
  const tokenBValue = position.tokenBValue ? parseFloat(position.tokenBValue) : 0;
  
  const rewardsValue = position.rewardsInfos.reduce((total: number, reward: any) => {
    const tokenValue = reward.tokenValue ? parseFloat(reward.tokenValue) : 0;
    return total + tokenValue;
  }, 0);
  
  return tokenAValue + tokenBValue + rewardsValue;
}

// Format position info
async function formatPositionInfo(position: any, index: number, lang: string, telegramId: number, getMessage: Function) {
  if (!position || !position.displayInfo) return '';
  
  const poolParts = position.displayInfo.pool.split(' - ');
  const tokenASymbol = poolParts[0].replace(/WSOL/gi, 'SOL');
  const tokenBSymbol = poolParts[1].replace(/WSOL/gi, 'SOL');
  
  const positionValue = await calculatePositionValue(position);

  const tokenAValue = position.tokenAValue ? parseFloat(position.tokenAValue) : 0;
  const tokenBValue = position.tokenBValue ? parseFloat(position.tokenBValue) : 0;
  const tokensValue = tokenAValue + tokenBValue;
  
  const unclaimedFeesValue = position.rewardsInfos
    .reduce((total: number, reward: any) => {
      const tokenValue = reward.tokenValue ? parseFloat(reward.tokenValue) : 0;
      return total + tokenValue;
    }, 0);
  
  const isInRange = parseFloat(position.displayInfo.pooledAmountA) > 0 && 
                   parseFloat(position.displayInfo.pooledAmountB) > 0;
  
  const poolAddress = position.poolId;
  const dexScreenerLink = `https://dexscreener.com/solana/${poolAddress}`;
  
  // Build TP/SL info
  let tpslInfo = '';
  const user = await User.findOne({ telegramId: telegramId });
  if (user && user.orcaLpPositions) {
    const positionSettings = user.orcaLpPositions.get(position.positionMint);
    if (positionSettings) {
      const initialValueText = getMessage('lpPortfolioMessages.initialValue', lang);
      tpslInfo += `💲 ${initialValueText}: $${formatNumber(positionSettings.initialValue)}\n`;
      
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
  
  const positionText = getMessage('lpPortfolioMessages.position', lang);
  const amountText = getMessage('lpPortfolioMessages.amount', lang);
  const valueText = getMessage('lpPortfolioMessages.value', lang);
  const unclaimedFeesText = getMessage('lpPortfolioMessages.unclaimedFees', lang);
  const statusText = getMessage('lpPortfolioMessages.status', lang);
  const inRangeText = getMessage('lpPortfolioMessages.inRange', lang);
  const outOfRangeText = getMessage('lpPortfolioMessages.outOfRange', lang);
  
  return `🌊 <b>${positionText} #${index}</b> ${tokenASymbol}/${tokenBSymbol}\n` +
         `💰 ${amountText}: ${formatNumber(position.displayInfo.pooledAmountA)} ${tokenASymbol} / ${formatNumber(position.displayInfo.pooledAmountB)} ${tokenBSymbol} ($${formatNumber(tokensValue)})\n` +
         `💸 ${unclaimedFeesText}: ${position.rewardsInfos.map((r: any) => `${formatNumber(r.amount)} ${r.mint}`).join(' / ')} ($${formatNumber(unclaimedFeesValue)})\n` +
         `💵 ${valueText}: $${formatNumber(positionValue)}\n` +
         `📊 ${statusText}: ${isInRange ? `✅ ${inRangeText}` : `❌ ${outOfRangeText}`}\n` +
         `${tpslInfo ? tpslInfo + '\n' : ''}`;
}

const orcaLpPortfolioCommand: CommandHandler = {
  command: 'orca_lp_portfolio',
  description: 'Show your Orca LP portfolio',
  handler: async (ctx: MyContext, getMessage) => {
    try {
      const telegramId = ctx.from?.id;
      if (!telegramId) {
        return ctx.reply(getMessage('lpPortfolioMessages.userIdError', ctx.session?.language || 'en'));
      }
      
      const user = await User.findOne({ telegramId });
      if (!user) {
        return ctx.reply(getMessage('lpPortfolioMessages.noUserFound', ctx.session?.language || 'en'));
      }
      
      const result = await OrcaService.getUserPositions(telegramId);
      if (!result.positions || result.positions.length === 0) {
        return ctx.reply(getMessage('lpPortfolioMessages.noPositions', ctx.session?.language || 'en'));
      }
      
      const lang = ctx.session?.language || 'en';
      const loadingMsg = await ctx.reply(getMessage('lpPortfolioMessages.loading', lang));
      
      const positionsInfo = await Promise.all(
        result.positions.map((position, index) => 
          formatPositionInfo(position, index + 1, lang, telegramId, getMessage)
        )
      );
      
      const totalValue = await result.positions.reduce(async (promisedTotal, position) => {
        const total = await promisedTotal;
        const value = await calculatePositionValue(position);
        return total + value;
      }, Promise.resolve(0));
      
      const portfolioTitle = getMessage('lpPortfolioMessages.portfolioTitle', lang);
      const totalValueText = getMessage('lpPortfolioMessages.totalValue', lang);
      
      const portfolioInfo = `🌊 <b>Orca ${portfolioTitle}</b>\n\n` +
                           `💰 ${totalValueText}: $${formatNumber(totalValue)}\n\n` +
                           `${positionsInfo.filter(Boolean).join('\n\n')}`;
      
      const inlineKeyboard = [];
      
      // Create Take Profit and Stop Loss buttons for each position
      result.positions.forEach((position, index) => {
        if (position && position.displayInfo) {
          const positionMint = position.positionMint || position.displayInfo.nft;
          inlineKeyboard.push([
            Markup.button.callback(
              `💹 Take Profit #${index + 1}`, 
              `orca_tp_${positionMint}`
            ),
            Markup.button.callback(
              `📉 Stop Loss #${index + 1}`, 
              `orca_sl_${positionMint}`
            )
          ]);
        }
      });
      
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
      console.error('Error in orcaLpPortfolio command:', error);
      const lang = ctx.session?.language || 'en';
      ctx.reply(getMessage('lpPortfolioMessages.error', lang));
    }
  }
};

// Handle Orca Take Profit button click
export async function handleOrcaTakeProfitButton(ctx: MyContext) {
  try {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;
    
    const callbackData = ctx.callbackQuery?.data;
    if (!callbackData) return;
    
    const positionMint = callbackData.replace('orca_tp_', '');
    
    ctx.session.editingPosition = {
      type: 'orcaTakeProfit',
      positionMint: positionMint
    };
    ctx.session.waitingForOrcaTakeProfitValue = true;
    ctx.session.positionSettingAttempts = 0;
    ctx.session.sessionStartTime = Date.now();
    
    const lang = ctx.session?.language || 'en';
    
    const user = await User.findOne({ telegramId });
    if (!user) return;
    
    const result = await OrcaService.getUserPositions(telegramId);
    if (!result.positions) return;
    
    const position = result.positions.find(p => 
      (p.positionMint === positionMint) || (p.displayInfo.nft === positionMint)
    );
    if (!position) return;
    
    const positionValue = await calculatePositionValue(position);
    
    await ctx.answerCbQuery();
    await ctx.reply(languageSettings.getMessage('lpPortfolioMessages.enterTakeProfitValue', lang)
      .replace('${0}', `$${formatNumber(positionValue)}`));
    
  } catch (error) {
    console.error('Error handling Orca Take Profit button:', error);
  }
}

// Handle Orca Stop Loss button click
export async function handleOrcaStopLossButton(ctx: MyContext) {
  try {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;
    
    const callbackData = ctx.callbackQuery?.data;
    if (!callbackData) return;
    
    const positionMint = callbackData.replace('orca_sl_', '');
    
    ctx.session.editingPosition = {
      type: 'orcaStopLoss',
      positionMint: positionMint
    };
    ctx.session.waitingForOrcaStopLossValue = true;
    ctx.session.positionSettingAttempts = 0;
    ctx.session.sessionStartTime = Date.now();
    
    const lang = ctx.session?.language || 'en';
    
    const user = await User.findOne({ telegramId });
    if (!user) return;
    
    const result = await OrcaService.getUserPositions(telegramId);
    if (!result.positions) return;
    
    const position = result.positions.find(p => 
      (p.positionMint === positionMint) || (p.displayInfo.nft === positionMint)
    );
    if (!position) return;
    
    const positionValue = await calculatePositionValue(position);
    
    await ctx.answerCbQuery();
    await ctx.reply(languageSettings.getMessage('lpPortfolioMessages.enterStopLossValue', lang)
      .replace('${0}', `$${formatNumber(positionValue)}`));
    
  } catch (error) {
    console.error('Error handling Orca Stop Loss button:', error);
  }
}

// Handle user input for Orca Take Profit or Stop Loss values
export async function handleOrcaPositionSettingInput(ctx: MyContext, getMessage: Function) {
  try {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;
    
    const lang = ctx.session?.language || 'en';
    
    if (!ctx.session.waitingForOrcaTakeProfitValue && !ctx.session.waitingForOrcaStopLossValue) return;
    
    // Check timeout (30 seconds)
    const currentTime = Date.now();
    const startTime = ctx.session.sessionStartTime || 0;
    if (currentTime - startTime > 30000) {
      ctx.session.waitingForOrcaTakeProfitValue = false;
      ctx.session.waitingForOrcaStopLossValue = false;
      ctx.session.editingPosition = undefined;
      return ctx.reply(getMessage('profitLossSettings.timeout', lang));
    }
    
    const text = ctx.message?.text;
    if (!text) return;
    
    let targetValue = parseFloat(text.replace(/[$,]/g, ''));
    
    if (isNaN(targetValue) || targetValue <= 0) {
      ctx.session.positionSettingAttempts = (ctx.session.positionSettingAttempts || 0) + 1;
      if (ctx.session.positionSettingAttempts >= 2) {
        ctx.session.waitingForOrcaTakeProfitValue = false;
        ctx.session.waitingForOrcaStopLossValue = false;
        ctx.session.editingPosition = undefined;
        return ctx.reply(getMessage('profitLossSettings.tooManyAttempts', lang));
      }
      return ctx.reply(getMessage('profitLossSettings.invalidPercentage', lang));
    }
    
    const user = await User.findOne({ telegramId });
    if (!user) return;
    
    const positionMint = ctx.session.editingPosition?.positionMint;
    if (!positionMint) return;
    
    const result = await OrcaService.getUserPositions(telegramId);
    if (!result.positions) return;
    
    const position = result.positions.find(p => 
      (p.positionMint === positionMint) || (p.displayInfo.nft === positionMint)
    );
    if (!position) return;
    
    const positionValue = await calculatePositionValue(position);
    const poolId = position.poolId;
    
    // Validate target value
    if (ctx.session.waitingForOrcaTakeProfitValue && targetValue <= positionValue) {
      return ctx.reply(getMessage('lpPortfolioMessages.takeProfitValueTooLow', lang)
        .replace('${0}', `$${formatNumber(positionValue)}`));
    }
    
    if (ctx.session.waitingForOrcaStopLossValue && targetValue >= positionValue) {
      return ctx.reply(getMessage('lpPortfolioMessages.stopLossValueTooHigh', lang)
        .replace('${0}', `$${formatNumber(positionValue)}`));
    }
    
    // Calculate percentage
    let percentage: number;
    if (ctx.session.waitingForOrcaTakeProfitValue) {
      percentage = ((targetValue - positionValue) / positionValue) * 100;
    } else {
      percentage = ((positionValue - targetValue) / positionValue) * 100;
    }
    
    percentage = Math.round(percentage * 100) / 100;
    
    // Initialize orcaLpPositions if it doesn't exist
    if (!user.orcaLpPositions) {
      user.orcaLpPositions = new Map();
    }
    
    // Get or create position settings
    let positionSettings = user.orcaLpPositions.get(positionMint);
    if (!positionSettings) {
      positionSettings = {
        poolId,
        nft: positionMint,
        publicKey: user.publicKey,
        initialValue: positionValue,
        createdAt: new Date()
      };
    }
    
    // Update Take Profit or Stop Loss settings
    if (ctx.session.waitingForOrcaTakeProfitValue) {
      positionSettings.takeProfit = {
        percentage,
        targetValue
      };
      positionSettings.triggeredProfit = false;
    } else {
      positionSettings.stopLoss = {
        percentage,
        targetValue
      };
      positionSettings.triggeredLoss = false;
    }
    
    // Save settings
    user.orcaLpPositions.set(positionMint, positionSettings);
    await user.save();
    
    // Send confirmation
    if (ctx.session.waitingForOrcaTakeProfitValue) {
      await ctx.reply(getMessage('lpPortfolioMessages.takeProfitSet', lang)
        .replace('${0}', percentage.toString())
        .replace('${1}', `$${formatNumber(targetValue)}`));
    } else {
      await ctx.reply(getMessage('lpPortfolioMessages.stopLossSet', lang)
        .replace('${0}', percentage.toString())
        .replace('${1}', `$${formatNumber(targetValue)}`));
    }

    // Reset session state
    ctx.session.waitingForOrcaTakeProfitValue = false;
    ctx.session.waitingForOrcaStopLossValue = false;
    ctx.session.editingPosition = undefined;
    
    // Refresh portfolio display
    await orcaLpPortfolioCommand.handler(ctx, getMessage);
    
  } catch (error) {
    console.error('Error handling Orca position setting input:', error);
    const lang = ctx.session?.language || 'en';
    ctx.reply(getMessage('profitLossSettings.setupFailed', lang));
  }
}

export default orcaLpPortfolioCommand;
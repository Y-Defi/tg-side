import { CommandHandler, MyContext } from '../types';
import { User } from '../models/User';
import { RaydiumService } from '../services/raydiumService';
import { MeteoraService } from '../services/meteoraService';
import { OrcaService } from '../services/orcaService';
import { Markup } from 'telegraf';

// 格式化数字显示
function formatNumber(num: string | number): string {
  const value = typeof num === 'string' ? parseFloat(num) : num;
  if (isNaN(value)) return '0';

  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(2)}K`;
  return value.toFixed(2);
}

// 计算position的总价值
async function calculatePositionValue(position: any): Promise<number> {
  const tokenAValue = position.tokenAValue ? parseFloat(position.tokenAValue) : 0;
  const tokenBValue = position.tokenBValue ? parseFloat(position.tokenBValue) : 0;

  const rewardsValue = position.rewardsInfos?.reduce((total: number, reward: any) => {
    const tokenValue = reward.tokenValue ? parseFloat(reward.tokenValue) : 0;
    return total + tokenValue;
  }, 0) || 0;

  return tokenAValue + tokenBValue + rewardsValue;
}

// 格式化Raydium position信息
async function formatRaydiumPosition(position: any, index: number, lang: string, telegramId: number, getMessage: Function) {
  if (!position || !position.displayInfo) return '';

  const poolParts = position.displayInfo.pool.split(' - ');
  const tokenASymbol = poolParts[0].replace(/WSOL/gi, 'SOL');
  const tokenBSymbol = poolParts[1].replace(/WSOL/gi, 'SOL');

  const positionValue = await calculatePositionValue(position);
  const tokenAValue = position.tokenAValue ? parseFloat(position.tokenAValue) : 0;
  const tokenBValue = position.tokenBValue ? parseFloat(position.tokenBValue) : 0;
  const tokensValue = tokenAValue + tokenBValue;

  const unclaimedFeesValue = position.rewardsInfos?.reduce((total: number, reward: any) => {
    const tokenValue = reward.tokenValue ? parseFloat(reward.tokenValue) : 0;
    return total + tokenValue;
  }, 0) || 0;

  const isInRange = parseFloat(position.displayInfo.pooledAmountA) > 0 &&
                   parseFloat(position.displayInfo.pooledAmountB) > 0;

  let tpslInfo = '';
  const user = await User.findOne({ telegramId });
  if (user && user.lpPositions) {
    const positionSettings = user.lpPositions.get(position.displayInfo.nft);
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

  return `⚡ <b>${positionText} #${index}</b> ${tokenASymbol}/${tokenBSymbol}\n` +
         `💰 ${amountText}: ${formatNumber(position.displayInfo.pooledAmountA)} ${tokenASymbol} / ${formatNumber(position.displayInfo.pooledAmountB)} ${tokenBSymbol} ($${formatNumber(tokensValue)})\n` +
         `💸 ${unclaimedFeesText}: ${position.rewardsInfos?.map((r: any) => `${formatNumber(r.amount)} ${r.mint}`).join(' / ') || 'N/A'} ($${formatNumber(unclaimedFeesValue)})\n` +
         `💵 ${valueText}: $${formatNumber(positionValue)}\n` +
         `📊 ${statusText}: ${isInRange ? `✅ ${inRangeText}` : `❌ ${outOfRangeText}`}\n` +
         `${tpslInfo ? tpslInfo + '\n' : ''}`;
}

// 格式化Meteora position信息
async function formatMeteoraPosition(position: any, index: number, lang: string, telegramId: number, getMessage: Function) {
  if (!position || !position.displayInfo) return '';

  const poolParts = position.displayInfo.pool.split(' - ');
  const tokenASymbol = poolParts[0].replace(/WSOL/gi, 'SOL');
  const tokenBSymbol = poolParts[1].replace(/WSOL/gi, 'SOL');

  const positionValue = await calculatePositionValue(position);
  const tokenAValue = position.tokenAValue ? parseFloat(position.tokenAValue) : 0;
  const tokenBValue = position.tokenBValue ? parseFloat(position.tokenBValue) : 0;
  const tokensValue = tokenAValue + tokenBValue;

  const unclaimedFeesValue = position.rewardsInfos?.reduce((total: number, reward: any) => {
    const tokenValue = reward.tokenValue ? parseFloat(reward.tokenValue) : 0;
    return total + tokenValue;
  }, 0) || 0;

  const isInRange = parseFloat(position.displayInfo.pooledAmountA) > 0 &&
                   parseFloat(position.displayInfo.pooledAmountB) > 0;

  let tpslInfo = '';
  const user = await User.findOne({ telegramId });
  if (user && user.lpPositions) {
    const positionSettings = user.lpPositions.get(position.displayInfo.nft);
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

  return `☄️ <b>Meteora ${positionText} #${index}</b> ${tokenASymbol}/${tokenBSymbol}\n` +
         `💰 ${amountText}: ${formatNumber(position.displayInfo.pooledAmountA)} ${tokenASymbol} / ${formatNumber(position.displayInfo.pooledAmountB)} ${tokenBSymbol} ($${formatNumber(tokensValue)})\n` +
         `💸 ${unclaimedFeesText}: ${position.rewardsInfos?.map((r: any) => `${formatNumber(r.amount)} ${r.mint}`).join(' / ') || 'N/A'} ($${formatNumber(unclaimedFeesValue)})\n` +
         `💵 ${valueText}: $${formatNumber(positionValue)}\n` +
         `📊 ${statusText}: ${isInRange ? `✅ ${inRangeText}` : `❌ ${outOfRangeText}`}\n` +
         `${tpslInfo ? tpslInfo + '\n' : ''}`;
}

// 格式化Orca position信息
async function formatOrcaPosition(position: any, index: number, lang: string, telegramId: number, getMessage: Function) {
  if (!position || !position.displayInfo) return '';

  const poolParts = position.displayInfo.pool.split(' - ');
  const tokenASymbol = poolParts[0].replace(/WSOL/gi, 'SOL');
  const tokenBSymbol = poolParts[1].replace(/WSOL/gi, 'SOL');

  const positionValue = await calculatePositionValue(position);
  const tokenAValue = position.tokenAValue ? parseFloat(position.tokenAValue) : 0;
  const tokenBValue = position.tokenBValue ? parseFloat(position.tokenBValue) : 0;
  const tokensValue = tokenAValue + tokenBValue;

  const unclaimedFeesValue = position.rewardsInfos?.reduce((total: number, reward: any) => {
    const tokenValue = reward.tokenValue ? parseFloat(reward.tokenValue) : 0;
    return total + tokenValue;
  }, 0) || 0;

  const isInRange = parseFloat(position.displayInfo.pooledAmountA) > 0 &&
                   parseFloat(position.displayInfo.pooledAmountB) > 0;

  let tpslInfo = '';
  const user = await User.findOne({ telegramId });
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
         `💸 ${unclaimedFeesText}: ${position.rewardsInfos?.map((r: any) => `${formatNumber(r.amount)} ${r.mint}`).join(' / ') || 'N/A'} ($${formatNumber(unclaimedFeesValue)})\n` +
         `💵 ${valueText}: $${formatNumber(positionValue)}\n` +
         `📊 ${statusText}: ${isInRange ? `✅ ${inRangeText}` : `❌ ${outOfRangeText}`}\n` +
         `${tpslInfo ? tpslInfo + '\n' : ''}`;
}

const lpPortfolioCommand: CommandHandler = {
  command: 'lp_portfolio',
  description: 'Show your LP portfolio from all AMMs',
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
      
      const lang = ctx.session?.language || 'en';
      const loadingMsg = await ctx.reply(getMessage('lpPortfolioMessages.loading', lang));
      
      // 并行获取所有positions
      const [raydiumResult, meteoraResult, orcaResult] = await Promise.allSettled([
        RaydiumService.getUserPositions(telegramId),
        MeteoraService.getUserPositions(telegramId),
        OrcaService.getUserPositions(telegramId)
      ]);

      const raydiumPositions = raydiumResult.status === 'fulfilled' && raydiumResult.value.positions ? raydiumResult.value.positions : [];
      const meteoraPositions = meteoraResult.status === 'fulfilled' && meteoraResult.value.positions ? meteoraResult.value.positions : [];
      const orcaPositions = orcaResult.status === 'fulfilled' && orcaResult.value.positions ? orcaResult.value.positions : [];

      if (raydiumPositions.length === 0 && meteoraPositions.length === 0 && orcaPositions.length === 0) {
        await ctx.telegram.editMessageText(
          ctx.chat?.id,
          loadingMsg.message_id,
          undefined,
          getMessage('lpPortfolioMessages.noPositions', lang)
        );
        return;
      }

      const totalValueText = getMessage('lpPortfolioMessages.totalValue', lang);
      const portfolioTitle = getMessage('lpPortfolioMessages.portfolioTitle', lang);
      let portfolioInfo = '';
      const allButtons: any[] = [];
      let buttonIndex = 1;

      // Raydium
      if (raydiumPositions.length > 0) {
        const raydiumValue = await raydiumPositions.reduce(async (promisedTotal, position) => {
          const total = await promisedTotal;
          const value = await calculatePositionValue(position);
          return total + value;
        }, Promise.resolve(0));

        portfolioInfo += `⚡ <b>Raydium ${portfolioTitle}</b>\n\n`;
        portfolioInfo += `💰 ${totalValueText}: $${formatNumber(raydiumValue)}\n\n`;

        for (let i = 0; i < raydiumPositions.length; i++) {
          const info = await formatRaydiumPosition(raydiumPositions[i], i + 1, lang, telegramId, getMessage);
          if (info) portfolioInfo += info + '\n';

          // Add buttons for this position
          if (raydiumPositions[i] && raydiumPositions[i].displayInfo) {
            const nftMint = raydiumPositions[i].displayInfo.nft;
            allButtons.push([
              Markup.button.callback(
                `💹 Take Profit #${buttonIndex}`,
                `tp_${nftMint}`
              ),
              Markup.button.callback(
                `📉 Stop Loss #${buttonIndex}`,
                `sl_${nftMint}`
              )
            ]);
            buttonIndex++;
          }
        }
        portfolioInfo += '\n';
      }

      // Meteora
      if (meteoraPositions.length > 0) {
        const meteoraValue = await meteoraPositions.reduce(async (promisedTotal, position) => {
          const total = await promisedTotal;
          const value = await calculatePositionValue(position);
          return total + value;
        }, Promise.resolve(0));

        portfolioInfo += `☄️ <b>Meteora ${portfolioTitle}</b>\n\n`;
        portfolioInfo += `💰 ${totalValueText}: $${formatNumber(meteoraValue)}\n\n`;

        for (let i = 0; i < meteoraPositions.length; i++) {
          const info = await formatMeteoraPosition(meteoraPositions[i], i + 1, lang, telegramId, getMessage);
          if (info) portfolioInfo += info + '\n';

          // Add buttons for this position
          if (meteoraPositions[i] && meteoraPositions[i].displayInfo) {
            const nftMint = meteoraPositions[i].displayInfo.nft;
            allButtons.push([
              Markup.button.callback(
                `💹 Take Profit #${buttonIndex}`,
                `tp_meteora_${nftMint}`
              ),
              Markup.button.callback(
                `📉 Stop Loss #${buttonIndex}`,
                `sl_meteora_${nftMint}`
              )
            ]);
            buttonIndex++;
          }
        }
        portfolioInfo += '\n';
      }

      // Orca
      if (orcaPositions.length > 0) {
        const orcaValue = await orcaPositions.reduce(async (promisedTotal, position) => {
          const total = await promisedTotal;
          const value = await calculatePositionValue(position);
          return total + value;
        }, Promise.resolve(0));

        portfolioInfo += `🌊 <b>Orca ${portfolioTitle}</b>\n\n`;
        portfolioInfo += `💰 ${totalValueText}: $${formatNumber(orcaValue)}\n\n`;

        for (let i = 0; i < orcaPositions.length; i++) {
          const info = await formatOrcaPosition(orcaPositions[i], i + 1, lang, telegramId, getMessage);
          if (info) portfolioInfo += info + '\n';

          // Add buttons for this position
          if (orcaPositions[i] && orcaPositions[i].displayInfo) {
            const positionMint = orcaPositions[i].positionMint || orcaPositions[i].displayInfo.nft;
            allButtons.push([
              Markup.button.callback(
                `💹 Take Profit #${buttonIndex}`,
                `orca_tp_${positionMint}`
              ),
              Markup.button.callback(
                `📉 Stop Loss #${buttonIndex}`,
                `orca_sl_${positionMint}`
              )
            ]);
            buttonIndex++;
          }
        }
      }

      await ctx.telegram.editMessageText(
        ctx.chat?.id,
        loadingMsg.message_id,
        undefined,
        portfolioInfo.trim(),
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard(allButtons)
        }
      );
      
    } catch (error) {
      console.error('Error in combined lpPortfolio command:', error);
      const lang = ctx.session?.language || 'en';
      ctx.reply(getMessage('lpPortfolioMessages.error', lang));
    }
  }
};

export default lpPortfolioCommand;
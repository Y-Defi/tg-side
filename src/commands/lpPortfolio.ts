import { CommandHandler, MyContext } from '../types';
import { User } from '../models/User';
import { RaydiumService } from '../services/raydiumService';
import { MeteoraService } from '../services/meteoraService';
import { OrcaService } from '../services/orcaService';
import { Markup } from 'telegraf';
import { languageSettings } from '../i18n';

// 统一Position接口
interface UnifiedPosition {
    source: 'raydium' | 'meteora' | 'orca';
    poolId: string;
    publicKey: string;
    positionMint?: string; // For Orca
    rewardsInfos: {
        mint: string;
        address: string;
        amount: string;
        decimals: number;
        tokenPrice?: string;
        tokenValue?: string;
    }[];
    tokenAPrice?: string;
    tokenBPrice?: string;
    tokenAValue?: string;
    tokenBValue?: string;
    displayInfo: {
        pool: string;
        nft: string;
        priceLower: string;
        priceUpper: string;
        pooledAmountA: string;
        pooledAmountB: string;
    };
}

// 格式化数字显示
function formatNumber(num: string | number): string {
  const value = typeof num === 'string' ? parseFloat(num) : num;
  if (isNaN(value)) return '0';
  
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(2)}K`;
  return value.toFixed(2);
}

// 计算position的总价值
async function calculatePositionValue(position: UnifiedPosition): Promise<number> {
  const tokenAValue = position.tokenAValue ? parseFloat(position.tokenAValue) : 0;
  const tokenBValue = position.tokenBValue ? parseFloat(position.tokenBValue) : 0;

  const rewardsValue = position.rewardsInfos?.reduce((total: number, reward: any) => {
    const tokenValue = reward.tokenValue ? parseFloat(reward.tokenValue) : 0;
    return total + tokenValue;
  }, 0) || 0;

  return tokenAValue + tokenBValue + rewardsValue;
}

// 获取来源图标
function getSourceIcon(source: string): string {
  switch (source) {
    case 'raydium': return '⚡';
    case 'meteora': return '🌟';
    case 'orca': return '🌊';
    default: return '🔸';
  }
}

// 格式化position信息
async function formatPositionInfo(position: UnifiedPosition, index: number, lang: string, telegramId: number, getMessage: Function) {
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
  
  // 构建止盈止损信息
  let tpslInfo = '';
  const user = await User.findOne({ telegramId: telegramId });
  if (user) {
    let positionSettings;
    const nftMint = position.displayInfo.nft;
    
    // 根据来源选择正确的position设置集合
    if (position.source === 'orca' && user.orcaLpPositions) {
      positionSettings = user.orcaLpPositions.get(position.positionMint || nftMint);
    } else if (user.lpPositions) {
      positionSettings = user.lpPositions.get(nftMint);
    }
    
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
  
  const sourceIcon = getSourceIcon(position.source);
  const sourceName = position.source.charAt(0).toUpperCase() + position.source.slice(1);
  
  return `${sourceIcon} <b>${sourceName} ${positionText} #${index}</b> ${tokenASymbol}/${tokenBSymbol}\n` +
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
      
      // 合并所有positions
      const allPositions: UnifiedPosition[] = [];
      
      if (raydiumResult.status === 'fulfilled' && raydiumResult.value.positions) {
        allPositions.push(...raydiumResult.value.positions.map(pos => ({
          ...pos,
          source: 'raydium' as const
        })));
      }
      
      if (meteoraResult.status === 'fulfilled' && meteoraResult.value.positions) {
        allPositions.push(...meteoraResult.value.positions.map(pos => ({
          ...pos,
          source: 'meteora' as const
        })));
      }
      
      if (orcaResult.status === 'fulfilled' && orcaResult.value.positions) {
        allPositions.push(...orcaResult.value.positions.map(pos => ({
          ...pos,
          source: 'orca' as const
        })));
      }
      
      if (allPositions.length === 0) {
        await ctx.telegram.editMessageText(
          ctx.chat?.id,
          loadingMsg.message_id,
          undefined,
          getMessage('lpPortfolioMessages.noPositions', lang)
        );
        return;
      }
      
      // 格式化每个position的信息
      const positionsInfo = await Promise.all(
        allPositions.map((position, index) => 
          formatPositionInfo(position, index + 1, lang, telegramId, getMessage)
        )
      );
      
      // 计算总价值
      const totalValue = await allPositions.reduce(async (promisedTotal, position) => {
        const total = await promisedTotal;
        const value = await calculatePositionValue(position);
        return total + value;
      }, Promise.resolve(0));
      
      const portfolioTitle = getMessage('lpPortfolioMessages.portfolioTitle', lang);
      const totalValueText = getMessage('lpPortfolioMessages.totalValue', lang);
      
      const portfolioInfo = `📊 <b>${portfolioTitle}</b>\n\n` +
                           `💰 ${totalValueText}: $${formatNumber(totalValue)}\n\n` +
                           `${positionsInfo.filter(Boolean).join('\n\n')}`;
      
      // 创建按钮
      const inlineKeyboard = [];
      
      allPositions.forEach((position, index) => {
        if (position && position.displayInfo) {
          const nftMint = position.displayInfo.nft;
          const positionMint = position.positionMint || nftMint;
          
          let tpCallback: string;
          let slCallback: string;
          
          if (position.source === 'orca') {
            tpCallback = `orca_tp_${positionMint}`;
            slCallback = `orca_sl_${positionMint}`;
          } else if (position.source === 'meteora') {
            tpCallback = `tp_meteora_${nftMint}`;
            slCallback = `sl_meteora_${nftMint}`;
          } else {
            tpCallback = `tp_${nftMint}`;
            slCallback = `sl_${nftMint}`;
          }
          
          inlineKeyboard.push([
            Markup.button.callback(
              `💹 Take Profit #${index + 1}`, 
              tpCallback
            ),
            Markup.button.callback(
              `📉 Stop Loss #${index + 1}`, 
              slCallback
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
      console.error('Error in combined lpPortfolio command:', error);
      const lang = ctx.session?.language || 'en';
      ctx.reply(getMessage('lpPortfolioMessages.error', lang));
    }
  }
};

export default lpPortfolioCommand;
import { Markup } from 'telegraf';
import { CommandHandler, MyContext } from '../types';
import { FetchPoolService, Pool } from '../services/fetchPoolService';

const raydiumTopPoolsCommand: CommandHandler = {
  command: 'raydium_top_pools',
  description: 'Show top Raydium liquidity pools',
  handler: async (ctx: MyContext, getMessage) => {
    try {
      const lang = ctx.session?.language || 'en';
      const loadingMsg = await ctx.reply(getMessage('pools.fetching', lang));
      
      const pools = await FetchPoolService.fetchTopPools();
      
      await ctx.telegram.deleteMessage(ctx.chat!.id, loadingMsg.message_id);

      // 确保session已初始化
      if (!ctx.session) ctx.session = { language: 'en', waitingForToken: false, referralCode: '' };
      ctx.session.poolOptions = pools;

      const poolsMessage = pools.map((pool, index) => 
          formatPoolMessage(pool, index + 1) 
      ).join('\n\n');

      // 直接发送消息，不包含按钮
      await ctx.reply(`⚡ <b>Top Raydium Pools</b>\n\n${poolsMessage}`, {
          parse_mode: 'HTML',
          disable_web_page_preview: true
      });

    } catch (error) {
      console.error('Error in topPools:', error);
      const lang = ctx.session.language || 'en';
      await ctx.reply(getMessage('pools.fetchError', lang));
    }
  }
};

function formatSymbol(token: any): string {
  return token.symbol === 'WSOL' ? 'SOL' : token.symbol;
}

function formatPoolMessage(pool: Pool, index: number): string {
  const formatNumber = (num: number) => {
      if (num >= 1e6) return `${(num / 1e6).toFixed(2)}M`;
      if (num >= 1e3) return `${(num / 1e3).toFixed(2)}K`;
      return num.toFixed(2);
  };

  const formatApr = (apr: number) => {
      const aprValue = apr;
      if (aprValue >= 1000) return `${aprValue.toFixed(2)}%`;
      return `${aprValue.toFixed(2)}%`;
  };

  const formatPair = () => {
      const tokenA = formatSymbol(pool.mintA);
      const tokenB = formatSymbol(pool.mintB);
      
      // 使用pool.id构建DexScreener链接
      const dexScreenerUrl = `https://dexscreener.com/solana/${pool.id}`;
      
      return `<a href="${dexScreenerUrl}">${tokenA}/${tokenB}</a>`;
  };
  const feeRatePercent = (pool.feeRate * 100).toFixed(2);

  return `<b>#${index} ${formatPair()}</b> | 💸 <code>${feeRatePercent}%</code>\n` +
         `💰 TVL: <b>$${formatNumber(pool.liquidity)}</b> | ` +
         `📊 Vol: <b>$${formatNumber(pool.day.volume)}</b> | ` +
         `💵 24h Fee: <b>$${formatNumber(pool.day.fee24h)}</b>\n` +
         `📈 APR: <code>${formatApr(pool.day.apr)}</code>`;
}



export default raydiumTopPoolsCommand;
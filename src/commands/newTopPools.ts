import { Markup } from 'telegraf';
import { CommandHandler, MyContext } from '../types';
import { FetchPoolService, PoolData } from '../services/fetchPoolService';
import { FetchMeteoraPoolService, MeteoraPoolData } from '../services/fetchMeteoraPoolService';
import { FetchOrcaPoolService, OrcaPoolData } from '../services/fetchOrcaPoolService';

// 统一池接口
interface UnifiedPoolData {
    id: string;
    source: 'raydium' | 'meteora' | 'orca';
    mintA: {
        address: string;
        symbol: string;
        name: string;
        decimals: number;
    };
    mintB: {
        address: string;
        symbol: string;
        name: string;
        decimals: number;
    };
    price: number;
    tvl: number;
    liquidity: number;
    feeRate: number;
    day: {
        volume: number;
        apr: number;
        feeApr: number;
        fee24h: number;
    };
}

const topPoolsCommand: CommandHandler = {
  command: 'top_pools',
  description: 'Show top liquidity pools from all AMMs',
  handler: async (ctx: MyContext, getMessage) => {
    try {
      const lang = ctx.session?.language || 'en';
      const loadingMsg = await ctx.reply(getMessage('pools.fetching', lang));
      
      // 并行获取所有AMM的top pools
      const [raydiumPools, meteoraPools, orcaPools] = await Promise.allSettled([
        FetchPoolService.fetchTopPools(200, 15),
        FetchMeteoraPoolService.fetchTopPools(200, 15),
        FetchOrcaPoolService.fetchTopPools(200, 15)
      ]);

      // 转换为统一格式
      const allPools: UnifiedPoolData[] = [];

      // 添加Raydium pools
      if (raydiumPools.status === 'fulfilled') {
        allPools.push(...raydiumPools.value.map(pool => ({
          ...pool,
          source: 'raydium' as const
        })));
      }

      // 添加Meteora pools
      if (meteoraPools.status === 'fulfilled') {
        allPools.push(...meteoraPools.value.map(pool => ({
          ...pool,
          source: 'meteora' as const
        })));
      }

      // 添加Orca pools
      if (orcaPools.status === 'fulfilled') {
        allPools.push(...orcaPools.value.map(pool => ({
          ...pool,
          source: 'orca' as const
        })));
      }

      // 按24h fee排序并取前10个
      const sortedPools = allPools
        .sort((a, b) => b.day.fee24h - a.day.fee24h)
        .slice(0, 10);
      
      await ctx.telegram.deleteMessage(ctx.chat!.id, loadingMsg.message_id);

      // 确保session已初始化
      if (!ctx.session) ctx.session = { language: 'en', waitingForToken: false, referralCode: '' };
      ctx.session.poolOptions = sortedPools;

      const poolsMessage = sortedPools.map((pool, index) => 
          formatUnifiedPoolMessage(pool, index + 1) 
      ).join('\n\n');

      // 直接发送消息，不包含按钮
      await ctx.reply(`🏆 <b>Top Pools (All AMMs)</b>\n\n${poolsMessage}`, {
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

function getSourceIcon(source: string): string {
  switch (source) {
    case 'raydium': return '⚡';
    case 'meteora': return '🌟';
    case 'orca': return '🌊';
    default: return '🔸';
  }
}

function formatUnifiedPoolMessage(pool: UnifiedPoolData, index: number): string {
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
  const sourceIcon = getSourceIcon(pool.source);
  const sourceName = pool.source.charAt(0).toUpperCase() + pool.source.slice(1);

  return `<b>#${index} ${formatPair()}</b> ${sourceIcon} <code>${sourceName}</code> | 💸 <code>${feeRatePercent}%</code>\n` +
         `💰 TVL: <b>$${formatNumber(pool.tvl)}</b> | ` +
         `📊 Vol: <b>$${formatNumber(pool.day.volume)}</b> | ` +
         `💵 24h Fee: <b>$${formatNumber(pool.day.fee24h)}</b>\n` +
         `📈 APR: <code>${formatApr(pool.day.apr)}</code>`;
}

export default topPoolsCommand;
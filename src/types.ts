import { Context as TelegrafContext } from 'telegraf';
import { Pool } from './services/fetchPoolService';

// 用户会话数据
export interface SessionData { 
    language: 'zh' | 'en'; 
    sessionStartTime: number | undefined; 
    waitingForToken: boolean; 
    waitingForBuyAmount?: boolean; 
    waitingForSellPercent?: boolean; 
    waitingForBuyToken?: boolean; 
    waitingForSellToken?: boolean; 
    waitingForTakeProfit?: boolean; 
    waitingForStopLoss?: boolean; 
    waitingForTakeProfitValue?: boolean; 
    waitingForStopLossValue?: boolean; 
    pendingMint?: string; 
    referralCode: string; 
    solAmount?: number; 
    currentToken?: { 
        mint: string; 
        symbol: string; 
        price: number; 
    }; 
    poolOptions?: Pool[]; 
    pools?: any[]; 
    selectedPool?: any; 
    waitingForCustomAmount?: boolean; 
    finalBalances?: { 
        tokenABalance: number; 
        tokenBBalance: number; 
    }; 
    positions?: { 
        [key: string]: { 
            nftMint: string; 
            poolId: string; 
        } 
    }; 
    waitingForWithdrawAddress?: boolean; 
    waitingForWithdrawAmount?: boolean; 
    withdrawAddress?: string; 
    settingsState?: 'waiting_for_tp' | 'waiting_for_sl'; 
    editingPosition?: { 
        type: 'takeProfit' | 'stopLoss'; 
        nftMint: string; 
        source?: 'raydium' | 'meteora';
    }; 
    positionAmounts?: { 
        tokenAAmount: number; 
        tokenBAmount: number; 
    }; 
    tokenInputAttempts?: number; 
    amountInputAttempts?: number; 
    percentInputAttempts?: number; 
    customAmountAttempts?: number; 
    withdrawAddressAttempts?: number; 
    withdrawAmountAttempts?: number; 
    settingsInputAttempts?: number; 
    positionSettingAttempts?: number; 
    positionStrategy?: 'aggressive' | 'conservative'; 
    rangePercent?: number; 
    positionSettingTimestamp?: number;
}

// 扩展Context类型，添加session
export interface MyContext extends TelegrafContext {
  session: SessionData;
}

// 多语言支持的消息类型
export interface Messages {
  [key: string]: {
    [key: string]: string | {
      [key: string]: string;
    };
  };
}

// 命令处理器接口
export interface CommandHandler {
  command: string;
  description: string;
  handler: (ctx: MyContext, getMessage: (key: string) => string) => Promise<void> | void;
}

// 用户语言设置
export interface LanguageSettings {
  defaultLanguage: string;
  messages: Messages;
  getMessage: (key: string, lang?: string) => string;
}

// TakeProfitStopLoss接口（从User.ts中提取）
export interface TakeProfitStopLoss {
  percentage: number;
  targetValue: number;
}


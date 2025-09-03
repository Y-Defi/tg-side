import axios from 'axios';
import { Token, IToken } from '../models/Token';

function formatPrice(price: number): string {
    return price.toFixed(6);
}

function formatLargeNumber(num: number): string {
    if (num >= 1e9) {
        return (num / 1e9).toFixed(2) + 'B';
    } else if (num >= 1e6) {
        return (num / 1e6).toFixed(2) + 'M';
    } else if (num >= 1e3) {
        return (num / 1e3).toFixed(2) + 'K';
    }
    return num.toFixed(2);
}

export interface TokenInfo {
    symbol: string;
    decimals: number;
    price: string;     
    liquidity: string; 
    mcap: string;      
    address: string;   
}

/**
 * 从API获取代币信息并保存到数据库
 */
async function fetchTokenInfoFromAPI(tokenMint: string): Promise<TokenInfo | null> {
    try {
        const response = await axios.get(`https://lite-api.jup.ag/tokens/v2/search?query=${tokenMint}`);
        const tokenData = response.data[0]; 
        
        if (!tokenData) {
            console.error(`No token info found for ${tokenMint}`);
            return null;
        }
        
        const tokenInfo: TokenInfo = {
            symbol: tokenData.symbol,
            decimals: tokenData.decimals,
            price: formatPrice(tokenData.usdPrice), 
            liquidity: formatLargeNumber(tokenData.liquidity || 0),
            mcap: formatLargeNumber(tokenData.mcap || 0),
            address: tokenMint
        };
        
        // 保存到数据库
        await Token.findOneAndUpdate(
            { address: tokenMint },
            { 
                ...tokenInfo,
                lastUpdated: new Date()
            },
            { upsert: true, new: true }
        );
        
        return tokenInfo;
    } catch (error) {
        console.error('Error fetching token info from API:', error.message);
        return null;
    }
}

/**
 * 获取代币信息，优先从数据库获取，如果不存在或过期则从API获取
 */
export async function getTokenInfo(tokenMint: string): Promise<TokenInfo | null> {
    try {
        // 从数据库查询代币信息
        const cachedToken = await Token.findOne({ address: tokenMint });
        
        // 检查是否存在缓存及是否过期（30分钟）
        const cacheExpired = cachedToken && 
            (new Date().getTime() - cachedToken.lastUpdated.getTime() > 30 * 60 * 1000);
        
        // 如果没有缓存或缓存已过期，从API获取
        if (!cachedToken || cacheExpired) {
            return await fetchTokenInfoFromAPI(tokenMint);
        }
        
        // 返回缓存的代币信息
        return {
            symbol: cachedToken.symbol,
            decimals: cachedToken.decimals,
            price: cachedToken.price,
            liquidity: cachedToken.liquidity,
            mcap: cachedToken.mcap,
            address: cachedToken.address
        };
    } catch (error) {
        console.error('Error in getTokenInfo:', error.message);
        // 如果数据库查询出错，尝试直接从API获取
        return await fetchTokenInfoFromAPI(tokenMint);
    }
}

/**
 * 更新所有代币信息
 * 此函数将被定时任务调用，每30秒更新一次所有代币信息
 */
export async function updateAllTokens(): Promise<void> {
    try {
        // 获取数据库中所有代币
        const tokens = await Token.find({});
        
        // 并行更新所有代币信息
        const updatePromises = tokens.map(token => 
            fetchTokenInfoFromAPI(token.address)
        );
        
        await Promise.all(updatePromises);
        console.log(`Updated ${tokens.length} tokens successfully`);
    } catch (error) {
        console.error('Error updating all tokens:', error.message);
    }
}


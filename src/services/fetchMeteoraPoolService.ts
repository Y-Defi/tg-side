import axios from 'axios';
import { Pool, IPool } from '../models/Pool';
import { getTokenInfo } from './tokenService';

interface TokenInfo {
    address: string;
    symbol: string;
    name: string;
    decimals: number;
}

export interface MeteoraPoolData {
    id: string;
    mintA: TokenInfo;
    mintB: TokenInfo;
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

// Based on the Meteora client code structure
interface MeteoraPoolDetail {
    address: string;
    name: string;
    mint_x: string;
    mint_y: string;
    reserve_x: string;
    reserve_y: string;
    reserve_x_amount: number;
    reserve_y_amount: number;
    bin_step: number;
    base_fee_percentage: string;
    max_fee_percentage: string;
    protocol_fee_percentage: string;
    liquidity: string;
    reward_mint_x: string;
    reward_mint_y: string;
    fees_24h: number;
    today_fees: number;
    trade_volume_24h: number;
    cumulative_trade_volume: string;
    cumulative_fee_volume: string;
    current_price: number;
    apr: number;
    apy: number;
    farm_apr: number;
    farm_apy: number;
    hide: boolean;
    is_blacklisted: boolean;
    fees: {
        min_30: number;
        hour_1: number;
        hour_2: number;
        hour_4: number;
        hour_12: number;
        hour_24: number;
    };
    fee_tvl_ratio: {
        min_30: number;
        hour_1: number;
        hour_2: number;
        hour_4: number;
        hour_12: number;
        hour_24: number;
    };
    volume: {
        min_30: number;
        hour_1: number;
        hour_2: number;
        hour_4: number;
        hour_12: number;
        hour_24: number;
    };
    tags: string[];
    launchpad: string | null;
    is_verified: boolean;
    token_x?: TokenInfo;
    token_y?: TokenInfo;
}

interface MeteoraApiResponse {
    pairs?: MeteoraPoolDetail[];
}

export class FetchMeteoraPoolService {
    private static readonly API_URL = 'https://dlmm-api.meteora.ag/pair/all_with_pagination';

    static async fetchTopPools(minApr: number = 200, limit: number = 10): Promise<MeteoraPoolData[]> {
        try {
            // 首先尝试从数据库获取数据
            const cachedPools = await Pool.find({
                'day.apr': { $gt: minApr },
                tvl: { $gte: 50000 },
                source: 'meteora'
            })
            .sort({ 'day.apr': -1 })
            .limit(limit);

            // 如果数据库中有数据且最后更新时间在5分钟内，直接返回
            const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
            if (cachedPools.length > 0 && 
                cachedPools.every(pool => pool.lastUpdated > fiveMinutesAgo)) {
                console.log('Using cached Meteora pool data from database');
                return cachedPools.map(pool => this.transformPoolFromDB(pool));
            }

            // 如果数据库中没有数据或数据已过期，从API获取
            console.log('Fetching fresh Meteora pool data from API');
            const response = await axios.get<MeteoraApiResponse>(this.API_URL, {
                params: {
                    page: 0,
                    limit: 100,
                    sort_key: 'volume12h'
                }
            });

            if (!response.data || !response.data.pairs) {
                throw new Error('Invalid response format from Meteora API');
            }


            const filteredPools = response.data.pairs
                .filter(pool => 
                    !pool.hide &&
                    !pool.is_blacklisted &&
                    pool.is_verified &&
                    parseFloat(pool.liquidity) >= 50000 &&
                    pool.volume.hour_24 > 0 &&
                    pool.apr * 365 > minApr &&
                    pool.fee_tvl_ratio?.hour_24 > 0
                )
                .sort((a, b) => 
                    b.volume.hour_24 - a.volume.hour_24 ||
                    parseFloat(b.liquidity) - parseFloat(a.liquidity)
                )
                .slice(0, limit);

            // 转换为我们的数据格式并更新数据库
            const transformedPools = await this.transformAndUpdatePools(filteredPools);

            return transformedPools;

        } catch (error) {
            console.error('Error fetching Meteora pool data:', error);
            // 如果API请求失败，尝试从数据库获取最新数据
            const cachedPools = await Pool.find({ source: 'meteora' })
                .sort({ 'day.apr': -1 })
                .limit(limit);
                
            if (cachedPools.length > 0) {
                console.log('Using cached Meteora pool data after API error');
                return cachedPools.map(pool => this.transformPoolFromDB(pool));
            }
            
            throw error;
        }
    }

    private static transformPoolFromDB(pool: IPool): MeteoraPoolData {
        return {
            id: pool.id,
            mintA: pool.mintA,
            mintB: pool.mintB,
            price: pool.price,
            tvl: pool.tvl,
            liquidity: pool.liquidity,
            feeRate: pool.feeRate,
            day: pool.day
        };
    }

    private static async transformAndUpdatePools(pools: MeteoraPoolDetail[]): Promise<MeteoraPoolData[]> {
        const now = new Date();
        const transformedPools: MeteoraPoolData[] = [];

        for (const pool of pools) {
            let tokenA: TokenInfo;
            let tokenB: TokenInfo;

            // 通过Jupiter API获取详细token信息
            const tokenAInfo = await getTokenInfo(pool.mint_x);
            const tokenBInfo = await getTokenInfo(pool.mint_y);
            tokenA = {
                address: tokenAInfo.address,
                symbol: tokenAInfo.symbol,
                name: tokenAInfo.symbol, // tokenService中没有name字段，使用symbol
                decimals: tokenAInfo.decimals
            };

            tokenB = {
                address: tokenBInfo.address,
                symbol: tokenBInfo.symbol,
                name: tokenBInfo.symbol, // tokenService中没有name字段，使用symbol
                decimals: tokenBInfo.decimals
            };

            const transformedPool: MeteoraPoolData = {
                id: pool.address,
                mintA: tokenA,
                mintB: tokenB,
                price: pool.current_price,
                tvl: parseFloat(pool.liquidity),
                liquidity: parseFloat(pool.liquidity),
                feeRate: pool.apr / 100, // Convert bin_step to percentage
                day: {
                    volume: pool.volume.hour_24,
                    apr: pool.apr * 365,
                    feeApr: pool.apr * 365,
                    fee24h: pool.fees.hour_24
                }
            };

            transformedPools.push(transformedPool);

            // 更新Pool数据库
            await Pool.findOneAndUpdate(
                { id: pool.address },
                {
                    id: pool.address,
                    source: 'meteora',
                    mintA: tokenA,
                    mintB: tokenB,
                    price: pool.current_price,
                    tvl: parseFloat(pool.liquidity),
                    liquidity: parseFloat(pool.liquidity),
                    feeRate: pool.apr / 100,
                    day: {
                        volume: pool.volume.hour_24,
                        apr: pool.apr * 365,
                        feeApr: pool.apr * 365,
                        fee24h: pool.fees.hour_24
                    },
                    lastUpdated: now
                },
                { upsert: true, new: true }
            );
        }

        console.log(`Updated ${transformedPools.length} Meteora pools in database`);
        return transformedPools;
    }

    // 手动更新所有池信息
    static async updateAllPools(): Promise<void> {
        try {
            console.log('Starting manual update of all Meteora pools');
            const response = await axios.get<MeteoraApiResponse>(this.API_URL, {
                params: {
                    page: 0,
                    limit: 100,
                    sort_key: 'volume'
                }
            });

            if (!response.data || !response.data.pairs) {
                throw new Error('Invalid response format from Meteora API');
            }

            const filteredPools = response.data.pairs
                .filter(pool => 
                    !pool.hide &&
                    !pool.is_blacklisted &&
                    parseFloat(pool.liquidity) >= 50000 &&
                    pool.volume.hour_24 > 0 &&
                    pool.fee_tvl_ratio?.hour_24 > 0
                );

            await this.transformAndUpdatePools(filteredPools);
            console.log('Manual Meteora pool update completed successfully');
        } catch (error) {
            console.error('Error updating Meteora pools:', error);
        }
    }

    static formatPoolInfo(pool: MeteoraPoolData): string {
        return `${pool.mintA.symbol}/${pool.mintB.symbol}\n` +
               `Price: $${pool.price.toFixed(4)}\n` +
               `TVL: $${pool.tvl.toLocaleString()}\n` +
               `24h Volume: $${pool.day.volume.toLocaleString()}\n` +
               `APR: ${pool.day.apr.toFixed(2)}%\n` +
               `Token A: ${pool.mintA.address}\n` +
               `Token B: ${pool.mintB.address}\n` +
               '------------------------';
    }

    static async getFormattedTopPools(): Promise<string> {
        try {
            const pools = await this.fetchTopPools();
            return pools.map((pool, index) => 
                `#${index + 1}\n${this.formatPoolInfo(pool)}`
            ).join('\n\n');
        } catch (error) {
            return 'Error fetching Meteora pool information';
        }
    }
}
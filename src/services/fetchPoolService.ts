import axios from 'axios';
import { Pool, IPool } from '../models/Pool';

interface TokenInfo {
    address: string;
    symbol: string;
    name: string;
    decimals: number;
}

export interface PoolData {
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

interface RaydiumResponse {
    success: boolean;
    data: {
        data: PoolData[];
    };
}

export class FetchPoolService {
    private static readonly API_URL = 'https://api-v3.raydium.io/pools/info/list';

    static async fetchTopPools(minApr: number = 200, limit: number = 10): Promise<PoolData[]> {
        try {
            // 首先尝试从数据库获取数据
            const cachedPools = await Pool.find({
                'day.apr': { $gt: minApr },
                tvl: { $gte: 50000 }
            })
            .sort({ 'day.apr': -1 })
            .limit(limit);

            // 如果数据库中有数据且最后更新时间在5分钟内，直接返回
            const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
            if (cachedPools.length > 0 && 
                cachedPools.every(pool => pool.lastUpdated > fiveMinutesAgo)) {
                console.log('Using cached pool data from database');
                return cachedPools.map(pool => ({
                    id: pool.id,
                    mintA: pool.mintA,
                    mintB: pool.mintB,
                    price: pool.price,
                    tvl: pool.tvl,
                    liquidity: pool.liquidity,
                    feeRate: pool.feeRate,
                    day: pool.day
                }));
            }

            // 如果数据库中没有数据或数据已过期，从API获取
            console.log('Fetching fresh pool data from API');
            const response = await axios.get<RaydiumResponse>(this.API_URL, {
                params: {
                    poolType: 'concentrated',
                    poolSortField: 'fee24h',
                    sortType: 'desc',
                    pageSize: 100,
                    page: 1
                }
            });

            if (!response.data.success) {
                throw new Error('Failed to fetch pool data');
            }

            const filteredPools = response.data.data.data
            .filter(pool => 
                pool.day.apr > minApr && 
                pool.tvl >= 50000 &&
                pool.feeRate > 0.0001 &&
                pool.mintA.symbol && 
                pool.mintB.symbol && 
                pool.mintA.symbol.trim() !== '' && 
                pool.mintB.symbol.trim() !== ''
            )
            .slice(0, limit);

            // 更新数据库
            await this.updatePoolsInDatabase(filteredPools);

            return filteredPools.map(pool => ({
                id: pool.id,
                mintA: {
                    address: pool.mintA.address,
                    symbol: pool.mintA.symbol,
                    name: pool.mintA.name,
                    decimals: pool.mintA.decimals
                },
                mintB: {
                    address: pool.mintB.address,
                    symbol: pool.mintB.symbol,
                    name: pool.mintB.name,
                    decimals: pool.mintB.decimals
                },
                price: pool.price,
                tvl: pool.tvl,
                liquidity: pool.tvl,
                feeRate: pool.feeRate,
                day: {
                    volume: pool.day.volume,
                    apr: pool.day.apr,
                    feeApr: pool.day.feeApr,
                    fee24h: pool.day.volumeFee
                }
            }));

        } catch (error) {
            console.error('Error fetching pool data:', error);
            // 如果API请求失败，尝试从数据库获取最新数据
            const cachedPools = await Pool.find()
                .sort({ 'day.apr': -1 })
                .limit(limit);
                
            if (cachedPools.length > 0) {
                console.log('Using cached pool data after API error');
                return cachedPools.map(pool => ({
                    id: pool.id,
                    mintA: pool.mintA,
                    mintB: pool.mintB,
                    price: pool.price,
                    tvl: pool.tvl,
                    liquidity: pool.liquidity,
                    feeRate: pool.feeRate,
                    day: pool.day
                }));
            }
            
            throw error;
        }
    }

    // 更新数据库中的池信息
    private static async updatePoolsInDatabase(pools: PoolData[]): Promise<void> {
        const now = new Date();
        
        for (const pool of pools) {
            await Pool.findOneAndUpdate(
                { id: pool.id },
                {
                    id: pool.id,
                    mintA: {
                        address: pool.mintA.address,
                        symbol: pool.mintA.symbol,
                        name: pool.mintA.name,
                        decimals: pool.mintA.decimals
                    },
                    mintB: {
                        address: pool.mintB.address,
                        symbol: pool.mintB.symbol,
                        name: pool.mintB.name,
                        decimals: pool.mintB.decimals
                    },
                    price: pool.price,
                    tvl: pool.tvl,
                    liquidity: pool.tvl,
                    feeRate: pool.feeRate,
                    day: {
                        volume: pool.day.volume,
                        apr: pool.day.apr,
                        feeApr: pool.day.feeApr,
                        fee24h: pool.day.volumeFee
                    },
                    lastUpdated: now
                },
                { upsert: true, new: true }
            );
        }
        
        console.log(`Updated ${pools.length} pools in database`);
    }

    // 手动更新所有池信息
    static async updateAllPools(): Promise<void> {
        try {
            console.log('Starting manual update of all pools');
            const response = await axios.get<RaydiumResponse>(this.API_URL, {
                params: {
                    poolType: 'concentrated',
                    poolSortField: 'fee24h',
                    sortType: 'desc',
                    pageSize: 100,
                    page: 1
                }
            });

            if (!response.data.success) {
                throw new Error('Failed to fetch pool data');
            }

            const filteredPools = response.data.data.data
            .filter(pool => 
                pool.tvl >= 50000 &&
                pool.feeRate > 0.0001 &&
                pool.mintA.symbol && 
                pool.mintB.symbol && 
                pool.mintA.symbol.trim() !== '' && 
                pool.mintB.symbol.trim() !== ''
            );

            await this.updatePoolsInDatabase(filteredPools);
            console.log('Manual pool update completed successfully');
        } catch (error) {
            console.error('Error updating pools:', error);
        }
    }

    static formatPoolInfo(pool: PoolData): string {
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
            return 'Error fetching pool information';
        }
    }
}

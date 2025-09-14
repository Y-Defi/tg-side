import axios from 'axios';
import { Pool, IPool } from '../models/Pool';

interface TokenInfo {
    address: string;
    symbol: string;
    name: string;
    decimals: number;
}

export interface OrcaPoolData {
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

// Based on the actual Orca API structure
interface OrcaPoolDetail {
    address: string;
    whirlpoolsConfig: string;
    whirlpoolBump: number[];
    tickSpacing: number;
    tickSpacingSeed: number[];
    feeRate: number;
    protocolFeeRate: number;
    liquidity: string;
    sqrtPrice: string;
    tickCurrentIndex: number;
    protocolFeeOwedA: string;
    protocolFeeOwedB: string;
    tokenMintA: string;
    tokenVaultA: string;
    feeGrowthGlobalA: string;
    tokenMintB: string;
    tokenVaultB: string;
    feeGrowthGlobalB: string;
    rewardLastUpdatedTimestamp: string;
    updatedAt: string;
    updatedSlot: number;
    writeVersion: number;
    hasWarning: boolean;
    poolType: string;
    tokenA: {
        address: string;
        programId: string;
        imageUrl: string;
        name: string;
        symbol: string;
        decimals: number;
        tags: string[];
    };
    tokenB: {
        address: string;
        programId: string;
        imageUrl: string;
        name: string;
        symbol: string;
        decimals: number;
        tags: string[];
    };
    price: string;
    tvlUsdc: string;
    yieldOverTvl: string;
    tokenBalanceA: string;
    tokenBalanceB: string;
    stats: {
        "24h": {
            volume: string;
            fees: string;
            rewards: string;
            yieldOverTvl: string;
        };
        "7d": {
            volume: string;
            fees: string;
            rewards: string;
            yieldOverTvl: string;
        };
        "30d": {
            volume: string;
            fees: string;
            rewards: string;
            yieldOverTvl: string;
        };
    };
    rewards: Array<{
        mint: string;
        vault: string;
        authority: string;
        emissions_per_second_x64: string;
        growth_global_x64: string;
        active: boolean;
        emissionsPerSecond: string;
    }>;
    lockedLiquidityPercent: Array<{
        name: string;
        locked_percentage: string;
        lockedPercentage: string;
    }>;
    feeTierIndex: number;
    adaptiveFeeEnabled: boolean;
    adaptiveFee: any;
    tradeEnableTimestamp: string;
}

interface OrcaApiResponse {
    data: OrcaPoolDetail[];
    meta: {
        next: string | null;
        previous: string | null;
    };
}

export class FetchOrcaPoolService {
    private static readonly API_URL = 'https://api.orca.so/v2/solana/pools';

    static async fetchTopPools(minApr: number = 200, limit: number = 10): Promise<OrcaPoolData[]> {
        try {
            // 首先尝试从数据库获取数据
            const cachedPools = await Pool.find({
                'day.apr': { $gt: minApr },
                tvl: { $gte: 50000 },
                source: 'orca'
            })
            .sort({ 'day.apr': -1 })
            .limit(limit);

            // 如果数据库中有数据且最后更新时间在5分钟内，直接返回
            const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
            if (cachedPools.length > 0 && 
                cachedPools.every((pool: IPool) => pool.lastUpdated > fiveMinutesAgo)) {
                console.log('Using cached Orca pool data from database');
                return cachedPools.map((pool: IPool) => this.transformPoolFromDB(pool));
            }

            // 如果数据库中没有数据或数据已过期，从API获取
            console.log('Fetching fresh Orca pool data from API');
            const response = await axios.get<OrcaApiResponse>(this.API_URL, {
                timeout: 30000,
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'TG-Side-Bot/1.0'
                },
                params: {
                    poolType: 'concentrated',
                    sortBy: 'fees24h',
                    sortDirection: 'desc',
                    size: 100,
                }
            });

            if (!response.data || !response.data.data) {
                throw new Error('Invalid response format from Orca API');
            }

            const filteredPools = response.data.data
                .filter((pool: OrcaPoolDetail) => 
                    parseFloat(pool.tvlUsdc) >= 50000 &&
                    !pool.hasWarning &&
                    parseFloat(pool.liquidity) > 0 &&
                    pool.stats && pool.stats["24h"] &&
                    parseFloat(pool.stats["24h"].yieldOverTvl) * 365 * 100 > minApr
                )
                .sort((a: OrcaPoolDetail, b: OrcaPoolDetail) => {
                    // Sort by 24h volume from stats
                    const aVolume = parseFloat(a.stats["24h"]?.volume || '0');
                    const bVolume = parseFloat(b.stats["24h"]?.volume || '0');
                    return bVolume - aVolume || parseFloat(b.tvlUsdc) - parseFloat(a.tvlUsdc);
                })
                .slice(0, limit);

            console.log(`Found ${filteredPools.length} Orca pools matching criteria`);

            // 转换为我们的数据格式并更新数据库
            const transformedPools = await this.transformAndUpdatePools(filteredPools);

            return transformedPools;

        } catch (error) {
            console.error('Error fetching Orca pool data:', error);
            // 如果API请求失败，尝试从数据库获取最新数据
            const cachedPools = await Pool.find({ source: 'orca' })
                .sort({ 'day.apr': -1 })
                .limit(limit);
                
            if (cachedPools.length > 0) {
                console.log('Using cached Orca pool data after API error');
                return cachedPools.map((pool: IPool) => this.transformPoolFromDB(pool));
            }
            
            throw error;
        }
    }

    private static transformPoolFromDB(pool: IPool): OrcaPoolData {
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

    private static async transformAndUpdatePools(pools: OrcaPoolDetail[]): Promise<OrcaPoolData[]> {
        const now = new Date();
        const transformedPools: OrcaPoolData[] = [];

        for (const pool of pools) {
            // API返回token信息，直接使用
            const tokenA: TokenInfo = {
                address: pool.tokenA.address,
                symbol: pool.tokenA.symbol,
                name: pool.tokenA.name,
                decimals: pool.tokenA.decimals
            };
            
            const tokenB: TokenInfo = {
                address: pool.tokenB.address,
                symbol: pool.tokenB.symbol,
                name: pool.tokenB.name,
                decimals: pool.tokenB.decimals
            };

            // Get 24h volume and fees from stats
            const stats24h = pool.stats["24h"];
            const volume24h = parseFloat(stats24h.volume);
            const fee24h = parseFloat(stats24h.fees);
            const apr = parseFloat(stats24h.yieldOverTvl) * 365 * 100; // Convert to APR percentage
            
            const transformedPool: OrcaPoolData = {
                id: pool.address,
                mintA: tokenA,
                mintB: tokenB,
                price: parseFloat(pool.price),
                tvl: parseFloat(pool.tvlUsdc),
                liquidity: parseFloat(pool.liquidity),
                feeRate: pool.feeRate / 10000, // Convert from basis points to decimal
                day: {
                    volume: volume24h,
                    apr: apr,
                    feeApr: apr, // Assuming APR includes fee APR
                    fee24h: fee24h
                }
            };

            transformedPools.push(transformedPool);

            // 更新Pool数据库
            await Pool.findOneAndUpdate(
                { id: pool.address },
                {
                    id: pool.address,
                    source: 'orca',
                    mintA: tokenA,
                    mintB: tokenB,
                    price: parseFloat(pool.price),
                    tvl: parseFloat(pool.tvlUsdc),
                    liquidity: parseFloat(pool.liquidity),
                    feeRate: pool.feeRate / 10000,
                    day: {
                        volume: volume24h,
                        apr: apr,
                        feeApr: apr,
                        fee24h: fee24h
                    },
                    lastUpdated: now
                },
                { upsert: true, new: true }
            );
        }

        console.log(`Updated ${transformedPools.length} Orca pools in database`);
        return transformedPools;
    }

    static formatPoolInfo(pool: OrcaPoolData): string {
        return `${pool.mintA.symbol}/${pool.mintB.symbol}\n` +
               `Price: $${pool.price.toFixed(6)}\n` +
               `TVL: $${pool.tvl.toLocaleString()}\n` +
               `24h Volume: $${pool.day.volume.toLocaleString()}\n` +
               `APR: ${pool.day.apr.toFixed(2)}%\n` +
               `Fee Rate: ${(pool.feeRate * 100).toFixed(2)}%\n` +
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
            return 'Error fetching Orca pool information';
        }
    }
}
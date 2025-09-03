import { ApiV3PoolInfoConcentratedItem, ApiV3Token, U64_IGNORE_RANGE, TickUtils, PoolUtils, ClmmKeys, CLMM_PROGRAM_ID, DEVNET_PROGRAM_ID } from '@raydium-io/raydium-sdk-v2'
import BN from 'bn.js'
import { initSdk } from '../config'
import Decimal from 'decimal.js'
import { PublicKey } from '@solana/web3.js'
import { PositionUtils } from '@raydium-io/raydium-sdk-v2'
import { TickArrayLayout } from '@raydium-io/raydium-sdk-v2'
import dotenv from 'dotenv';
import { getTokenInfo } from './tokenService';
import { User } from '../models/User'; 
import { ProfitLossService } from './profitLossService'; 

dotenv.config();


interface RaydiumError extends Error {
    code?: string | number;
    txid?: string;
    instruction?: string;
}

interface PositionInfo {
    poolId: string; // 新增字段
    publicKey: string; 
    // poolInfo: ApiV3PoolInfoConcentratedItem; // 移除
    // rewards: { mint: ApiV3Token; amount: Decimal }[]; // 移除
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

interface ServiceResult {
    error?: {
        key: string;
        params?: Record<string, string>;
    };
    txid?: string;
    positions?: PositionInfo[];
}


export class RaydiumService {
    private static formatError(key: string, params?: Record<string, string>): ServiceResult {
        return { error: { key, params } };
    }
    
    // 定时更新任务的间隔（5分钟）
    private static readonly UPDATE_INTERVAL = 5 * 60 * 1000; // 5分钟 = 5 * 60 * 1000毫秒
    private static updateTimers: Map<number, NodeJS.Timeout> = new Map();
    private static globalUpdateTimer: NodeJS.Timeout | null = null;

    /**
     * 获取用户的position信息
     * 不再直接提供给外部调用，而是通过getUserPositions方法获取缓存的数据
     */
    private static async updatePositionInfo(telegramId: number): Promise<ServiceResult> {
        try {
            // 查找用户
            const user = await User.findOne({ telegramId });
            if (!user) {
                return this.formatError('userNotFound');
            }

            console.log(`Updating positions for user ${telegramId}`);
            
            // 初始化Raydium SDK
            const raydium = await initSdk({
                telegramId,
                loadToken: true
            });

            const positionsInfo: PositionInfo[] = [];

            // 获取用户positions
            const allPositions = await raydium.clmm.getOwnerPositionInfo({ 
                programId: raydium.cluster === 'mainnet' ? CLMM_PROGRAM_ID : DEVNET_PROGRAM_ID.CLMM
            });

            if (!allPositions.length) {
                // 更新用户的lastPositionUpdate和空的positions数组
                user.lastPositionUpdate = new Date();
                user.positions = [];
                await user.save();
                
                return this.formatError('userNoPositions');
            }

            for (const position of allPositions) {
                let poolInfo: ApiV3PoolInfoConcentratedItem;

                if (raydium.cluster === 'mainnet') {
                    poolInfo = (await raydium.api.fetchPoolById({ 
                        ids: position.poolId.toBase58() 
                    }))[0] as ApiV3PoolInfoConcentratedItem;
                } else {
                    const data = await raydium.clmm.getPoolInfoFromRpc(position.poolId.toBase58());
                    poolInfo = data.poolInfo;
                }

                const epochInfo = await raydium.connection.getEpochInfo();

                // Get position price range
                const priceLower = TickUtils.getTickPrice({
                    poolInfo,
                    tick: position.tickLower,
                    baseIn: true,
                });
                const priceUpper = TickUtils.getTickPrice({
                    poolInfo,
                    tick: position.tickUpper,
                    baseIn: true,
                });

                // Get pooled amounts
                const { amountA, amountB } = PositionUtils.getAmountsFromLiquidity({
                    poolInfo,
                    ownerPosition: position,
                    liquidity: position.liquidity,
                    slippage: 0,
                    add: false,
                    epochInfo,
                });

                const [pooledAmountA, pooledAmountB] = [
                    new Decimal(amountA.amount.toString()).div(10 ** poolInfo.mintA.decimals),
                    new Decimal(amountB.amount.toString()).div(10 ** poolInfo.mintB.decimals),
                ];

                // Get tick array addresses
                const [tickLowerArrayAddress, tickUpperArrayAddress] = [
                    TickUtils.getTickArrayAddressByTick(
                        new PublicKey(poolInfo.programId),
                        new PublicKey(poolInfo.id),
                        position.tickLower,
                        poolInfo.config.tickSpacing
                    ),
                    TickUtils.getTickArrayAddressByTick(
                        new PublicKey(poolInfo.programId),
                        new PublicKey(poolInfo.id),
                        position.tickUpper,
                        poolInfo.config.tickSpacing
                    ),
                ];

                // Get tick data
                const tickArrayRes = await raydium.connection.getMultipleAccountsInfo([
                    tickLowerArrayAddress, 
                    tickUpperArrayAddress
                ]);

                if (!tickArrayRes[0] || !tickArrayRes[1]) {
                    console.error('Tick data not found for position:', position.nftMint.toBase58());
                    continue;
                }

                const tickArrayLower = TickArrayLayout.decode(tickArrayRes[0].data);
                const tickArrayUpper = TickArrayLayout.decode(tickArrayRes[1].data);
                const tickLowerState = tickArrayLower.ticks[
                    TickUtils.getTickOffsetInArray(position.tickLower, poolInfo.config.tickSpacing)
                ];
                const tickUpperState = tickArrayUpper.ticks[
                    TickUtils.getTickOffsetInArray(position.tickUpper, poolInfo.config.tickSpacing)
                ];

                // Get fees and rewards
                const rpcPoolData = await raydium.clmm.getRpcClmmPoolInfo({ poolId: position.poolId });
                const tokenFees = PositionUtils.GetPositionFeesV2(rpcPoolData, position, tickLowerState, tickUpperState);
                const rewards = PositionUtils.GetPositionRewardsV2(rpcPoolData, position, tickLowerState, tickUpperState);

                // Calculate fees
                const [tokenFeeAmountA, tokenFeeAmountB] = [
                    tokenFees.tokenFeeAmountA.gte(new BN(0)) && tokenFees.tokenFeeAmountA.lt(U64_IGNORE_RANGE)
                        ? tokenFees.tokenFeeAmountA
                        : new BN(0),
                    tokenFees.tokenFeeAmountB.gte(new BN(0)) && tokenFees.tokenFeeAmountB.lt(U64_IGNORE_RANGE)
                        ? tokenFees.tokenFeeAmountB
                        : new BN(0),
                ];

                // Calculate rewards
                const [rewardMintAFee, rewardMintBFee] = [
                    {
                        mint: poolInfo.mintA,
                        amount: new Decimal(tokenFeeAmountA.toString())
                            .div(10 ** poolInfo.mintA.decimals)
                            .toDecimalPlaces(poolInfo.mintA.decimals),
                    },
                    {
                        mint: poolInfo.mintB,
                        amount: new Decimal(tokenFeeAmountB.toString())
                            .div(10 ** poolInfo.mintB.decimals)
                            .toDecimalPlaces(poolInfo.mintB.decimals),
                    },
                ];

                const rewardInfos = rewards.map((r) => 
                    (r.gte(new BN(0)) && r.lt(U64_IGNORE_RANGE) ? r : new BN(0))
                );

                const poolRewardInfos = rewardInfos
                    .map((r, idx) => {
                        const rewardMint = poolInfo.rewardDefaultInfos.find(
                            (r) => r.mint.address === rpcPoolData.rewardInfos[idx].tokenMint.toBase58()
                        )?.mint;

                        if (!rewardMint) return undefined;
                        return {
                            mint: rewardMint,
                            amount: new Decimal(r.toString())
                                .div(10 ** rewardMint.decimals)
                                .toDecimalPlaces(rewardMint.decimals)
                        };
                    })
                    .filter(Boolean) as { mint: ApiV3Token; amount: Decimal }[];

                // Add fees to rewards
                const feeARewardIdx = poolRewardInfos.findIndex((r) => r!.mint.address === poolInfo.mintA.address);
                if (poolRewardInfos[feeARewardIdx])
                    poolRewardInfos[feeARewardIdx].amount = poolRewardInfos[feeARewardIdx].amount.add(rewardMintAFee.amount);
                else
                    poolRewardInfos.push(rewardMintAFee);

                const feeBRewardIdx = poolRewardInfos.findIndex((r) => r!.mint.address === poolInfo.mintB.address);
                if (poolRewardInfos[feeBRewardIdx])
                    poolRewardInfos[feeBRewardIdx].amount = poolRewardInfos[feeBRewardIdx].amount.add(rewardMintBFee.amount);
                else
                    poolRewardInfos.push(rewardMintBFee);

                // 获取代币价格信息
                const tokenAInfo = await getTokenInfo(poolInfo.mintA.address);
                const tokenBInfo = await getTokenInfo(poolInfo.mintB.address);
                
                // 计算代币价值
                const tokenAPrice = tokenAInfo ? tokenAInfo.price : '0';
                const tokenBPrice = tokenBInfo ? tokenBInfo.price : '0';
                const tokenAValue = new Decimal(pooledAmountA.toString()).mul(tokenAPrice).toString();
                const tokenBValue = new Decimal(pooledAmountB.toString()).mul(tokenBPrice).toString();

                // 获取奖励代币的价格和价值
                const rewardsWithValues = await Promise.all(poolRewardInfos.map(async (r) => {
                    const rewardTokenInfo = await getTokenInfo(r.mint.address);
                    const tokenPrice = rewardTokenInfo ? rewardTokenInfo.price : '0';
                    const tokenValue = new Decimal(r.amount.toString()).mul(tokenPrice).toString();
                    
                    return {
                        mint: r.mint.symbol.replace(/WSOL/gi, 'SOL'),
                        address: r.mint.address,
                        amount: r.amount.toString(),
                        decimals: r.mint.decimals,
                        tokenPrice,
                        tokenValue
                    };
                }));

                positionsInfo.push({
                    poolId: poolInfo.id, // 新增字段，存储池ID
                    publicKey: user.publicKey,
                    // poolInfo, // 移除
                    // rewards: poolRewardInfos, // 移除
                    rewardsInfos: rewardsWithValues,
                    tokenAPrice,
                    tokenBPrice,
                    tokenAValue,
                    tokenBValue,
                    displayInfo: {
                        pool: `${poolInfo.mintA.symbol} - ${poolInfo.mintB.symbol}`,
                        nft: position.nftMint.toBase58(),
                        priceLower: priceLower.price.toString(),
                        priceUpper: priceUpper.price.toString(),
                        pooledAmountA: pooledAmountA.toString(),
                        pooledAmountB: pooledAmountB.toString()
                    }
                });
            }

            // 更新用户的lastPositionUpdate和positions数组
            user.lastPositionUpdate = new Date();
            user.positions = positionsInfo;
            await user.save();

            console.log(`Updated positions for user ${telegramId}, found ${positionsInfo.length} positions`);
            
            await ProfitLossService.checkAndApplyProfitLoss(telegramId);
            
            return { positions: positionsInfo };

        } catch (error) {
            const err = error as Error;
            console.error('Error in updatePositionInfo:', {
                error,
                message: err.message,
                stack: err.stack
            });
            return this.formatError('updatePositionFailed', { message: err.message });
        }
    }

    /**
     * 获取用户的position信息（从数据库中获取缓存的数据）
     * 如果数据库中没有数据，则触发一次更新
     */
    static async getUserPositions(telegramId: number): Promise<ServiceResult> {
        try {
            // 查找用户
            const user = await User.findOne({ telegramId });
            if (!user) {
                return this.formatError('userNotFound');
            }

            // 过滤positions，只返回publicKey等于user.publicKey的position
            const filteredPositions = user.positions?.filter(position => position.publicKey === user.publicKey) || [];
            
            // 如果没有过滤后的positions数据，触发一次更新
            if (filteredPositions.length === 0) {
                console.log(`No filtered positions for user ${telegramId}, triggering update`);
                return await this.updatePositionInfo(telegramId);
            }

            console.log(`Using cached positions for user ${telegramId}, last updated: ${user.lastPositionUpdate}`);
            return { positions: filteredPositions };

        } catch (error) {
            const err = error as Error;
            console.error('Error in getUserPositions:', {
                error,
                message: err.message,
                stack: err.stack
            });
            return this.formatError('getUserPositionsFailed', { message: err.message });
        }
    }

    /**
     * 启动用户的position定时更新任务
     * 每5分钟更新一次用户的position信息
     */
    static startPositionUpdateTask(telegramId: number): void {
        // 如果已经有定时任务，先清除
        if (this.updateTimers.has(telegramId)) {
            clearInterval(this.updateTimers.get(telegramId)!);
        }

        // 立即执行一次更新
        this.updatePositionInfo(telegramId).catch(err => {
            console.error(`Initial position update failed for user ${telegramId}:`, err);
        });

        // 设置定时任务，每5分钟更新一次
        const timer = setInterval(() => {
            this.updatePositionInfo(telegramId).catch(err => {
                console.error(`Scheduled position update failed for user ${telegramId}:`, err);
            });
        }, this.UPDATE_INTERVAL);

        // 保存定时器引用，以便后续可以清除
        this.updateTimers.set(telegramId, timer);
        console.log(`Started position update task for user ${telegramId}`);
    }

    /**
     * 停止用户的position定时更新任务
     */
    static stopPositionUpdateTask(telegramId: number): void {
        if (this.updateTimers.has(telegramId)) {
            clearInterval(this.updateTimers.get(telegramId)!);
            this.updateTimers.delete(telegramId);
            console.log(`Stopped position update task for user ${telegramId}`);
        }
    }

    /**
     * 手动触发更新用户的position信息
     */
    static async triggerPositionUpdate(telegramId: number): Promise<ServiceResult> {
        return await this.updatePositionInfo(telegramId);
    }

    /**
     * 更新所有用户的position信息
     * 遍历所有用户并更新他们的position信息
     */
    private static async updateAllUsersPositions(): Promise<void> {
        try {
            console.log('Starting update for all users positions');
            
            // 获取所有用户
            const users = await User.find({});
            console.log(`Found ${users.length} users to update positions`);
            
            // 遍历所有用户并更新他们的position信息
            for (const user of users) {
                if (!user.telegramId) continue;
                
                try {
                    await this.updatePositionInfo(user.telegramId);
                    console.log(`Updated positions for user ${user.telegramId}`);
                } catch (err) {
                    console.error(`Failed to update positions for user ${user.telegramId}:`, err);
                }
            }
            
            console.log('Completed update for all users positions');
        } catch (error) {
            console.error('Error in updateAllUsersPositions:', error);
        }
    }

    /**
     * 启动全局position定时更新任务
     * 每5分钟更新一次所有用户的position信息
     */
    static startGlobalPositionUpdateTask(): void {
        // 如果已经有全局定时任务，先清除
        if (this.globalUpdateTimer) {
            clearInterval(this.globalUpdateTimer);
            this.globalUpdateTimer = null;
        }

        // 立即执行一次更新
        this.updateAllUsersPositions().catch(err => {
            console.error('Initial global position update failed:', err);
        });

        // 设置定时任务，每5分钟更新一次所有用户的position信息
        this.globalUpdateTimer = setInterval(() => {
            this.updateAllUsersPositions().catch(err => {
                console.error('Scheduled global position update failed:', err);
            });
        }, this.UPDATE_INTERVAL);

        console.log('Started global position update task');
    }

    /**
     * 停止全局position定时更新任务
     */
    static stopGlobalPositionUpdateTask(): void {
        if (this.globalUpdateTimer) {
            clearInterval(this.globalUpdateTimer);
            this.globalUpdateTimer = null;
            console.log('Stopped global position update task');
        }
    }
}


import { PublicKey } from '@solana/web3.js';
import { 
    WhirlpoolContext, 
    ORCA_WHIRLPOOL_PROGRAM_ID, 
    PriceMath,
    getAllPositionAccountsByOwner,
    PositionData,
    WhirlpoolData
} from '@orca-so/whirlpools-sdk';
import { Wallet } from '@coral-xyz/anchor/dist/cjs/provider';
import BN from 'bn.js';
import Decimal from 'decimal.js';
import { User } from '../models/User';
import { getTokenInfo } from './tokenService';
import { ProfitLossService } from './profitLossService';
import dotenv from 'dotenv';
import {connection} from "../config";

dotenv.config();

interface OrcaPositionInfo {
    poolId: string;
    publicKey: string;
    positionMint: string;
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
    positions?: OrcaPositionInfo[];
}

// Mock wallet implementation for read-only operations
class ReadOnlyWallet implements Wallet {
    constructor(readonly publicKey: PublicKey) {}
    
    async signTransaction(): Promise<any> {
        throw new Error('Read-only wallet cannot sign transactions');
    }
    
    async signAllTransactions(): Promise<any[]> {
        throw new Error('Read-only wallet cannot sign transactions');
    }
}

export class OrcaService {
    private static readonly UPDATE_INTERVAL = 5 * 60 * 1000; // 5 minutes
    private static updateTimers: Map<number, NodeJS.Timeout> = new Map();
    private static globalUpdateTimer: NodeJS.Timeout | null = null;

    private static formatError(key: string, params?: Record<string, string>): ServiceResult {
        return { error: { key, params } };
    }

    /**
     * Calculate token amounts from position liquidity
     */
    private static calculateTokenAmounts(
        position: PositionData,
        whirlpool: WhirlpoolData
    ): { amountA: BN; amountB: BN } {
        try {
            const liquidity = position.liquidity;
            const sqrtPrice = whirlpool.sqrtPrice;
            const tickLower = position.tickLowerIndex;
            const tickUpper = position.tickUpperIndex;
            
            // Calculate sqrt prices for the position range
            const sqrtPriceLower = PriceMath.tickIndexToSqrtPriceX64(tickLower);
            const sqrtPriceUpper = PriceMath.tickIndexToSqrtPriceX64(tickUpper);
            
            // Calculate token amounts based on current price position
            let amountA = new BN(0);
            let amountB = new BN(0);
            
            if (sqrtPrice.lt(sqrtPriceLower)) {
                // Current price is below range, all liquidity is in token A
                amountA = this.getTokenAmountFromLiquidity(
                    liquidity,
                    sqrtPriceLower,
                    sqrtPriceUpper,
                    true
                );
            } else if (sqrtPrice.gt(sqrtPriceUpper)) {
                // Current price is above range, all liquidity is in token B
                amountB = this.getTokenAmountFromLiquidity(
                    liquidity,
                    sqrtPriceLower,
                    sqrtPriceUpper,
                    false
                );
            } else {
                // Current price is in range, liquidity is in both tokens
                amountA = this.getTokenAmountFromLiquidity(
                    liquidity,
                    sqrtPrice,
                    sqrtPriceUpper,
                    true
                );
                amountB = this.getTokenAmountFromLiquidity(
                    liquidity,
                    sqrtPriceLower,
                    sqrtPrice,
                    false
                );
            }
            
            return { amountA, amountB };
        } catch (err) {
            console.error('Error calculating token amounts:', err);
            return { amountA: new BN(0), amountB: new BN(0) };
        }
    }
    
    /**
     * Helper function to calculate token amount from liquidity
     */
    private static getTokenAmountFromLiquidity(
        liquidity: BN,
        sqrtPriceLower: BN,
        sqrtPriceUpper: BN,
        isTokenA: boolean
    ): BN {
        if (liquidity.eq(new BN(0))) return new BN(0);
        
        const Q64 = new BN(2).pow(new BN(64));
        
        if (isTokenA) {
            // amount = liquidity * (sqrtPriceUpper - sqrtPriceLower) / (sqrtPriceUpper * sqrtPriceLower / Q64)
            const priceDiff = sqrtPriceUpper.sub(sqrtPriceLower);
            const denominator = sqrtPriceUpper.mul(sqrtPriceLower).div(Q64);
            return liquidity.mul(priceDiff).div(denominator);
        } else {
            // amount = liquidity * (sqrtPriceUpper - sqrtPriceLower) / Q64
            const priceDiff = sqrtPriceUpper.sub(sqrtPriceLower);
            return liquidity.mul(priceDiff).div(Q64);
        }
    }

    /**
     * Update user's Orca position info
     */
    private static async updatePositionInfo(telegramId: number): Promise<ServiceResult> {
        try {
            const user = await User.findOne({ telegramId });
            if (!user) {
                return this.formatError('userNotFound');
            }

            console.log(`Updating Orca positions for user ${telegramId}`);

            // Create read-only wallet from user's public key
            const userPublicKey = new PublicKey(user.publicKey);
            const wallet = new ReadOnlyWallet(userPublicKey);

            const ctx = WhirlpoolContext.from(connection, wallet, ORCA_WHIRLPOOL_PROGRAM_ID);

            // Get all positions for the user
            const positionMap = await getAllPositionAccountsByOwner({
                ctx,
                owner: userPublicKey,
                includesPositions: true,
                includesPositionsWithTokenExtensions: true,
                includesBundledPositions: false
            });

            const positionsInfo: OrcaPositionInfo[] = [];

            // Combine positions and positionsWithTokenExtensions
            const allPositions = new Map([
                ...positionMap.positions,
                ...positionMap.positionsWithTokenExtensions
            ]);

            if (allPositions.size === 0) {
                await User.findOneAndUpdate(
                    { telegramId },
                    { 
                        lastPositionUpdate: new Date(),
                        orcaPositions: []
                    },
                    { new: true }
                );
                
                console.log(`No Orca positions found for user ${telegramId}`);
                return { positions: [] };
            }

            // Create account fetcher using the context's fetcher
            const fetcher = ctx.fetcher;
            
            // Get whirlpool data for all positions
            const positionDatas = Array.from(allPositions.values());
            
            // Fetch unique whirlpool addresses
            const uniqueWhirlpoolAddresses = [...new Set(positionDatas.map(pos => pos.whirlpool.toString()))];
            const whirlpools = new Map<string, WhirlpoolData>();
            
            // Fetch each whirlpool
            for (const whirlpoolAddress of uniqueWhirlpoolAddresses) {
                try {
                    const whirlpoolPubkey = new PublicKey(whirlpoolAddress);
                    const whirlpoolData = await fetcher.getPool(whirlpoolPubkey);
                    if (whirlpoolData) {
                        whirlpools.set(whirlpoolAddress, whirlpoolData);
                    }
                } catch (err) {
                    console.error(`Error fetching whirlpool ${whirlpoolAddress}:`, err);
                }
            }

            // Process each position
            for (const [address, position] of allPositions) {
                try {
                    const whirlpool = whirlpools.get(position.whirlpool.toString());
                    if (!whirlpool) {
                        console.error(`Whirlpool not found for position ${address}`);
                        continue;
                    }

                    // Get token info
                    const tokenAInfo = await getTokenInfo(whirlpool.tokenMintA.toString());
                    const tokenBInfo = await getTokenInfo(whirlpool.tokenMintB.toString());
                    
                    const tokenADecimals = tokenAInfo?.decimals || 9;
                    const tokenBDecimals = tokenBInfo?.decimals || 9;

                    // Calculate token amounts
                    const { amountA, amountB } = this.calculateTokenAmounts(position, whirlpool);
                    
                    const pooledAmountA = new Decimal(amountA.toString()).div(10 ** tokenADecimals);
                    const pooledAmountB = new Decimal(amountB.toString()).div(10 ** tokenBDecimals);

                    // Calculate values
                    const tokenAPrice = tokenAInfo?.price || '0';
                    const tokenBPrice = tokenBInfo?.price || '0';
                    const tokenAValue = pooledAmountA.mul(tokenAPrice).toString();
                    const tokenBValue = pooledAmountB.mul(tokenBPrice).toString();

                    // Calculate fees (simplified - includes both collected and uncollected)
                    const feeOwedA = new Decimal(position.feeOwedA.toString()).div(10 ** tokenADecimals);
                    const feeOwedB = new Decimal(position.feeOwedB.toString()).div(10 ** tokenBDecimals);
                    
                    // Calculate rewards
                    const rewardsInfos = [];
                    
                    if (feeOwedA.gt(0)) {
                        const feeValueA = feeOwedA.mul(tokenAPrice);
                        rewardsInfos.push({
                            mint: tokenAInfo?.symbol || 'Unknown',
                            address: whirlpool.tokenMintA.toString(),
                            amount: feeOwedA.toString(),
                            decimals: tokenADecimals,
                            tokenPrice: tokenAPrice,
                            tokenValue: feeValueA.toString()
                        });
                    }

                    if (feeOwedB.gt(0)) {
                        const feeValueB = feeOwedB.mul(tokenBPrice);
                        rewardsInfos.push({
                            mint: tokenBInfo?.symbol || 'Unknown',
                            address: whirlpool.tokenMintB.toString(),
                            amount: feeOwedB.toString(),
                            decimals: tokenBDecimals,
                            tokenPrice: tokenBPrice,
                            tokenValue: feeValueB.toString()
                        });
                    }

                    // Add reward tokens if present
                    for (let i = 0; i < position.rewardInfos.length; i++) {
                        const rewardInfo = position.rewardInfos[i];
                        const rewardAmount = rewardInfo.amountOwed;
                        if (rewardAmount && rewardAmount.gt(new BN(0))) {
                            const whirlpoolRewardInfo = whirlpool.rewardInfos[i];
                            if (whirlpoolRewardInfo && whirlpoolRewardInfo.mint) {
                                const rewardTokenInfo = await getTokenInfo(whirlpoolRewardInfo.mint.toString());
                                const rewardDecimals = rewardTokenInfo?.decimals || 9;
                                const rewardAmountDecimal = new Decimal(rewardAmount.toString()).div(10 ** rewardDecimals);
                                const rewardPrice = rewardTokenInfo?.price || '0';
                                const rewardValue = rewardAmountDecimal.mul(rewardPrice);
                                
                                rewardsInfos.push({
                                    mint: rewardTokenInfo?.symbol || 'Unknown',
                                    address: whirlpoolRewardInfo.mint.toString(),
                                    amount: rewardAmountDecimal.toString(),
                                    decimals: rewardDecimals,
                                    tokenPrice: rewardPrice,
                                    tokenValue: rewardValue.toString()
                                });
                            }
                        }
                    }

                    // Calculate price bounds
                    const priceLower = PriceMath.tickIndexToPrice(
                        position.tickLowerIndex,
                        tokenADecimals,
                        tokenBDecimals
                    );
                    const priceUpper = PriceMath.tickIndexToPrice(
                        position.tickUpperIndex,
                        tokenADecimals,
                        tokenBDecimals
                    );

                    positionsInfo.push({
                        poolId: position.whirlpool.toString(),
                        publicKey: user.publicKey,
                        positionMint: position.positionMint.toString(),
                        rewardsInfos,
                        tokenAPrice,
                        tokenBPrice,
                        tokenAValue,
                        tokenBValue,
                        displayInfo: {
                            pool: `${tokenAInfo?.symbol || 'Unknown'} - ${tokenBInfo?.symbol || 'Unknown'}`,
                            nft: position.positionMint.toString(),
                            priceLower: priceLower.toFixed(6),
                            priceUpper: priceUpper.toFixed(6),
                            pooledAmountA: pooledAmountA.toString(),
                            pooledAmountB: pooledAmountB.toString()
                        }
                    });
                } catch (err) {
                    console.error(`Error processing Orca position ${address}:`, err);
                    continue;
                }
            }

            // Update user's position data
            await User.findOneAndUpdate(
                { telegramId },
                { 
                    lastPositionUpdate: new Date(),
                    orcaPositions: positionsInfo
                },
                { new: true }
            );

            console.log(`Updated ${positionsInfo.length} Orca positions for user ${telegramId}`);
            
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
     * Get user's Orca positions (from cached data)
     */
    static async getUserPositions(telegramId: number): Promise<ServiceResult> {
        try {
            const user = await User.findOne({ telegramId });
            if (!user) {
                return this.formatError('userNotFound');
            }

            // Filter positions by current public key
            const filteredPositions = user.orcaPositions?.filter(
                position => position.publicKey === user.publicKey
            ) || [];
            
            // If no cached positions, trigger an update
            if (filteredPositions.length === 0) {
                console.log(`No Orca positions for user ${telegramId}, triggering update`);
                return await this.updatePositionInfo(telegramId);
            }

            console.log(`Using cached Orca positions for user ${telegramId}`);
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
     * Start position update task for a user
     */
    static startPositionUpdateTask(telegramId: number): void {
        if (this.updateTimers.has(telegramId)) {
            clearInterval(this.updateTimers.get(telegramId)!);
        }

        // Initial update
        this.updatePositionInfo(telegramId).catch(err => {
            console.error(`Initial Orca position update failed for user ${telegramId}:`, err);
        });

        // Set up periodic updates
        const timer = setInterval(() => {
            this.updatePositionInfo(telegramId).catch(err => {
                console.error(`Scheduled Orca position update failed for user ${telegramId}:`, err);
            });
        }, this.UPDATE_INTERVAL);

        this.updateTimers.set(telegramId, timer);
        console.log(`Started Orca position update task for user ${telegramId}`);
    }

    /**
     * Stop position update task for a user
     */
    static stopPositionUpdateTask(telegramId: number): void {
        if (this.updateTimers.has(telegramId)) {
            clearInterval(this.updateTimers.get(telegramId)!);
            this.updateTimers.delete(telegramId);
            console.log(`Stopped Orca position update task for user ${telegramId}`);
        }
    }

    /**
     * Manually trigger position update
     */
    static async triggerPositionUpdate(telegramId: number): Promise<ServiceResult> {
        return await this.updatePositionInfo(telegramId);
    }

    /**
     * Update all users' Orca positions
     */
    private static async updateAllUsersPositions(): Promise<void> {
        try {
            console.log('Starting update for all users Orca positions');
            
            const users = await User.find({});
            console.log(`Found ${users.length} users to update Orca positions`);
            
            for (const user of users) {
                if (!user.telegramId) continue;
                
                try {
                    await this.updatePositionInfo(user.telegramId);
                    console.log(`Updated Orca positions for user ${user.telegramId}`);
                } catch (err) {
                    console.error(`Failed to update Orca positions for user ${user.telegramId}:`, err);
                }
            }
            
            console.log('Completed update for all users Orca positions');
        } catch (error) {
            console.error('Error in updateAllUsersPositions:', error);
        }
    }

    /**
     * Start global position update task
     */
    static startGlobalPositionUpdateTask(): void {
        if (this.globalUpdateTimer) {
            clearInterval(this.globalUpdateTimer);
            this.globalUpdateTimer = null;
        }

        // Initial update
        this.updateAllUsersPositions().catch(err => {
            console.error('Initial global Orca position update failed:', err);
        });

        // Set up periodic updates
        this.globalUpdateTimer = setInterval(() => {
            this.updateAllUsersPositions().catch(err => {
                console.error('Scheduled global Orca position update failed:', err);
            });
        }, this.UPDATE_INTERVAL);

        console.log('Started global Orca position update task');
    }

    /**
     * Stop global position update task
     */
    static stopGlobalPositionUpdateTask(): void {
        if (this.globalUpdateTimer) {
            clearInterval(this.globalUpdateTimer);
            this.globalUpdateTimer = null;
            console.log('Stopped global Orca position update task');
        }
    }
}
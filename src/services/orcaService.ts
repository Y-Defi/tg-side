import { PublicKey, Connection } from '@solana/web3.js';
import { WhirlpoolContext, ORCA_WHIRLPOOL_PROGRAM_ID, PDAUtil, PoolUtil, PriceMath, collectFeesQuote, collectRewardsQuote, buildWhirlpoolClient, WhirlpoolClient } from '@orca-so/whirlpools-sdk';
// import { Wallet } from '@project-serum/anchor';
import BN from 'bn.js';
import Decimal from 'decimal.js';
import { User } from '../models/User';
import { getTokenInfo } from './tokenService';
import { ProfitLossService } from './profitLossService';
import dotenv from 'dotenv';

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

export class OrcaService {
    private static readonly UPDATE_INTERVAL = 5 * 60 * 1000; // 5 minutes
    private static updateTimers: Map<number, NodeJS.Timeout> = new Map();
    private static globalUpdateTimer: NodeJS.Timeout | null = null;

    private static formatError(key: string, params?: Record<string, string>): ServiceResult {
        return { error: { key, params } };
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

            // Initialize connection
            const connection = new Connection(
                process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com',
                'confirmed'
            );

            // Create a wallet from user's private key (implementation depends on your setup)
            const userPublicKey = new PublicKey(user.publicKey);
            
            // Get all token accounts owned by the user
            const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
                userPublicKey,
                { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }
            );

            const positionsInfo: OrcaPositionInfo[] = [];

            // Filter for Orca position NFTs
            for (const account of tokenAccounts.value) {
                const parsedInfo = account.account.data.parsed.info;
                if (parsedInfo.tokenAmount.uiAmount === 1 && parsedInfo.tokenAmount.decimals === 0) {
                    // This might be a position NFT
                    const mintAddress = new PublicKey(parsedInfo.mint);
                    
                    try {
                        // Get position PDA
                        const positionPDA = PDAUtil.getPosition(
                            ORCA_WHIRLPOOL_PROGRAM_ID,
                            mintAddress
                        );

                        // Fetch position data
                        const positionData = await connection.getAccountInfo(positionPDA.publicKey);
                        if (!positionData) continue;

                        // Parse position data (simplified - you'll need proper deserialization)
                        // This is a placeholder - actual implementation would use Anchor deserialization
                        const position = await this.parsePositionData(connection, positionPDA.publicKey, mintAddress);
                        if (!position) continue;

                        // Get whirlpool data
                        const whirlpoolAddress = position.whirlpool;
                        const whirlpoolData = await connection.getAccountInfo(whirlpoolAddress);
                        if (!whirlpoolData) continue;

                        // Parse whirlpool data (simplified)
                        const whirlpool = await this.parseWhirlpoolData(connection, whirlpoolAddress);
                        if (!whirlpool) continue;

                        // Calculate position amounts
                        const sqrtPriceX64 = whirlpool.sqrtPrice;
                        const tickLower = position.tickLowerIndex;
                        const tickUpper = position.tickUpperIndex;
                        const liquidity = position.liquidity;

                        // Calculate token amounts (simplified)
                        const amounts = PoolUtil.getTokenAmountsFromLiquidity(
                            liquidity,
                            sqrtPriceX64,
                            PriceMath.tickIndexToSqrtPriceX64(tickLower),
                            PriceMath.tickIndexToSqrtPriceX64(tickUpper),
                            true
                        );

                        // Get token info
                        const tokenAInfo = await getTokenInfo(whirlpool.tokenMintA.toString());
                        const tokenBInfo = await getTokenInfo(whirlpool.tokenMintB.toString());

                        const tokenADecimals = tokenAInfo?.decimals || 9;
                        const tokenBDecimals = tokenBInfo?.decimals || 9;

                        const pooledAmountA = new Decimal(amounts.tokenA.toString()).div(10 ** tokenADecimals);
                        const pooledAmountB = new Decimal(amounts.tokenB.toString()).div(10 ** tokenBDecimals);

                        // Calculate values
                        const tokenAPrice = tokenAInfo?.price || '0';
                        const tokenBPrice = tokenBInfo?.price || '0';
                        const tokenAValue = pooledAmountA.mul(tokenAPrice).toString();
                        const tokenBValue = pooledAmountB.mul(tokenBPrice).toString();

                        // Calculate fees and rewards (simplified)
                        const fees = await this.calculateFees(connection, position, whirlpool);
                        const rewards = await this.calculateRewards(connection, position, whirlpool);

                        // Format rewards info
                        const rewardsInfos = [];
                        
                        // Add fee rewards
                        if (fees.tokenA.gt(new BN(0))) {
                            const feeAmountA = new Decimal(fees.tokenA.toString()).div(10 ** tokenADecimals);
                            const feeValueA = feeAmountA.mul(tokenAPrice);
                            rewardsInfos.push({
                                mint: tokenAInfo?.symbol || 'Unknown',
                                address: whirlpool.tokenMintA.toString(),
                                amount: feeAmountA.toString(),
                                decimals: tokenADecimals,
                                tokenPrice: tokenAPrice,
                                tokenValue: feeValueA.toString()
                            });
                        }

                        if (fees.tokenB.gt(new BN(0))) {
                            const feeAmountB = new Decimal(fees.tokenB.toString()).div(10 ** tokenBDecimals);
                            const feeValueB = feeAmountB.mul(tokenBPrice);
                            rewardsInfos.push({
                                mint: tokenBInfo?.symbol || 'Unknown',
                                address: whirlpool.tokenMintB.toString(),
                                amount: feeAmountB.toString(),
                                decimals: tokenBDecimals,
                                tokenPrice: tokenBPrice,
                                tokenValue: feeValueB.toString()
                            });
                        }

                        // Add reward token rewards
                        for (let i = 0; i < rewards.length; i++) {
                            if (rewards[i] && rewards[i].gt(new BN(0))) {
                                const rewardTokenInfo = await getTokenInfo(whirlpool.rewardInfos[i].mint.toString());
                                const rewardDecimals = rewardTokenInfo?.decimals || 9;
                                const rewardAmount = new Decimal(rewards[i].toString()).div(10 ** rewardDecimals);
                                const rewardPrice = rewardTokenInfo?.price || '0';
                                const rewardValue = rewardAmount.mul(rewardPrice);
                                
                                rewardsInfos.push({
                                    mint: rewardTokenInfo?.symbol || 'Unknown',
                                    address: whirlpool.rewardInfos[i].mint.toString(),
                                    amount: rewardAmount.toString(),
                                    decimals: rewardDecimals,
                                    tokenPrice: rewardPrice,
                                    tokenValue: rewardValue.toString()
                                });
                            }
                        }

                        // Calculate price bounds
                        const priceLower = PriceMath.tickIndexToPrice(
                            tickLower,
                            tokenADecimals,
                            tokenBDecimals
                        );
                        const priceUpper = PriceMath.tickIndexToPrice(
                            tickUpper,
                            tokenADecimals,
                            tokenBDecimals
                        );

                        positionsInfo.push({
                            poolId: whirlpoolAddress.toString(),
                            publicKey: user.publicKey,
                            positionMint: mintAddress.toString(),
                            rewardsInfos,
                            tokenAPrice,
                            tokenBPrice,
                            tokenAValue,
                            tokenBValue,
                            displayInfo: {
                                pool: `${tokenAInfo?.symbol || 'Unknown'} - ${tokenBInfo?.symbol || 'Unknown'}`,
                                nft: mintAddress.toString(),
                                priceLower: priceLower.toFixed(6),
                                priceUpper: priceUpper.toFixed(6),
                                pooledAmountA: pooledAmountA.toString(),
                                pooledAmountB: pooledAmountB.toString()
                            }
                        });
                    } catch (err) {
                        console.error(`Error processing potential Orca position ${mintAddress.toString()}:`, err);
                        continue;
                    }
                }
            }

            // Update user's position data
            user.lastPositionUpdate = new Date();
            user.orcaPositions = positionsInfo;
            await user.save();

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
     * Parse position data from account (simplified placeholder)
     */
    private static async parsePositionData(connection: Connection, positionAddress: PublicKey, mintAddress: PublicKey): Promise<any> {
        // This is a simplified placeholder
        // Actual implementation would use proper Anchor IDL deserialization
        try {
            const accountInfo = await connection.getAccountInfo(positionAddress);
            if (!accountInfo) return null;
            
            // Mock position data structure
            return {
                whirlpool: new PublicKey('11111111111111111111111111111111'), // placeholder
                positionMint: mintAddress,
                liquidity: new BN(0),
                tickLowerIndex: 0,
                tickUpperIndex: 0,
                feeGrowthCheckpointA: new BN(0),
                feeGrowthCheckpointB: new BN(0),
                feeOwedA: new BN(0),
                feeOwedB: new BN(0)
            };
        } catch (err) {
            console.error('Error parsing position data:', err);
            return null;
        }
    }

    /**
     * Parse whirlpool data from account (simplified placeholder)
     */
    private static async parseWhirlpoolData(connection: Connection, whirlpoolAddress: PublicKey): Promise<any> {
        // This is a simplified placeholder
        // Actual implementation would use proper Anchor IDL deserialization
        try {
            const accountInfo = await connection.getAccountInfo(whirlpoolAddress);
            if (!accountInfo) return null;
            
            // Mock whirlpool data structure
            return {
                tokenMintA: new PublicKey('11111111111111111111111111111111'), // placeholder
                tokenMintB: new PublicKey('11111111111111111111111111111111'), // placeholder
                tokenVaultA: new PublicKey('11111111111111111111111111111111'),
                tokenVaultB: new PublicKey('11111111111111111111111111111111'),
                sqrtPrice: new BN(0),
                tickCurrentIndex: 0,
                feeRate: 3000,
                protocolFeeRate: 300,
                liquidity: new BN(0),
                feeGrowthGlobalA: new BN(0),
                feeGrowthGlobalB: new BN(0),
                rewardInfos: []
            };
        } catch (err) {
            console.error('Error parsing whirlpool data:', err);
            return null;
        }
    }

    /**
     * Calculate fees for a position (simplified)
     */
    private static async calculateFees(connection: Connection, position: any, whirlpool: any): Promise<{ tokenA: BN, tokenB: BN }> {
        // Simplified fee calculation
        // Actual implementation would use collectFeesQuote from SDK
        return {
            tokenA: new BN(0),
            tokenB: new BN(0)
        };
    }

    /**
     * Calculate rewards for a position (simplified)
     */
    private static async calculateRewards(connection: Connection, position: any, whirlpool: any): Promise<BN[]> {
        // Simplified reward calculation
        // Actual implementation would use collectRewardsQuote from SDK
        return [new BN(0), new BN(0), new BN(0)];
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
import { PublicKey, Connection } from '@solana/web3.js';
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
     * Note: This is a simplified mock implementation. 
     * In production, you would need to properly integrate with Orca's API or SDK
     */
    private static async updatePositionInfo(telegramId: number): Promise<ServiceResult> {
        try {
            const user = await User.findOne({ telegramId });
            if (!user) {
                return this.formatError('userNotFound');
            }

            console.log(`Updating Orca positions for user ${telegramId}`);

            // For now, return empty positions since we don't have actual Orca integration
            // In a real implementation, you would:
            // 1. Connect to Solana
            // 2. Query user's Orca positions
            // 3. Parse and format the data
            const positionsInfo: OrcaPositionInfo[] = [];

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

    /**
     * Mock function to create sample Orca position data for testing
     * Remove this in production and replace with actual Orca integration
     */
    static createMockPosition(userId: string): OrcaPositionInfo {
        return {
            poolId: 'mock_pool_' + Math.random().toString(36).substring(7),
            publicKey: userId,
            positionMint: 'mock_mint_' + Math.random().toString(36).substring(7),
            rewardsInfos: [
                {
                    mint: 'SOL',
                    address: '11111111111111111111111111111111',
                    amount: '0.1',
                    decimals: 9,
                    tokenPrice: '100',
                    tokenValue: '10'
                }
            ],
            tokenAPrice: '100',
            tokenBPrice: '1',
            tokenAValue: '1000',
            tokenBValue: '1000',
            displayInfo: {
                pool: 'SOL - USDC',
                nft: 'mock_nft_' + Math.random().toString(36).substring(7),
                priceLower: '90',
                priceUpper: '110',
                pooledAmountA: '10',
                pooledAmountB: '1000'
            }
        };
    }
}
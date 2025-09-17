import DLMM from '@meteora-ag/dlmm'
import { Connection, PublicKey } from '@solana/web3.js'
import Decimal from 'decimal.js'
import dotenv from 'dotenv'
import { getTokenInfo } from './tokenService'
import { User } from '../models/User'
import { ProfitLossService } from './profitLossService'
import { connection } from '../config'

dotenv.config()

interface MeteoraError extends Error {
    code?: string | number
    txid?: string
    instruction?: string
}

interface MeteoraPositionInfo {
    poolId: string
    publicKey: string
    rewardsInfos: {
        mint: string
        address: string
        amount: string
        decimals: number
        tokenPrice?: string
        tokenValue?: string
    }[]
    tokenAPrice?: string
    tokenBPrice?: string
    tokenAValue?: string
    tokenBValue?: string
    displayInfo: {
        pool: string
        nft: string
        priceLower: string
        priceUpper: string
        pooledAmountA: string
        pooledAmountB: string
    }
}

interface ServiceResult {
    error?: {
        key: string
        params?: Record<string, string>
    }
    txid?: string
    positions?: MeteoraPositionInfo[]
}

export class MeteoraService {
    private static formatError(key: string, params?: Record<string, string>): ServiceResult {
        return { error: { key, params } }
    }
    
    // 定时更新任务的间隔（5分钟）
    private static readonly UPDATE_INTERVAL = 5 * 60 * 1000 // 5分钟 = 5 * 60 * 1000毫秒
    private static updateTimers: Map<number, NodeJS.Timeout> = new Map()
    private static globalUpdateTimer: NodeJS.Timeout | null = null

    /**
     * 获取用户的Meteora position信息
     * 不再直接提供给外部调用，而是通过getUserPositions方法获取缓存的数据
     */
    private static async updatePositionInfo(telegramId: number): Promise<ServiceResult> {
        try {
            // 查找用户
            const user = await User.findOne({ telegramId })
            if (!user) {
                return this.formatError('userNotFound')
            }

            console.log(`Updating Meteora positions for user ${telegramId}`)
            
            const positionsInfo: MeteoraPositionInfo[] = []
            const userPublicKey = new PublicKey(user.publicKey)
            
            // 获取用户所有的position账户
            const userPositions = await DLMM.getAllLbPairPositionsByUser(connection,userPublicKey)

            if (userPositions.size === 0) {
                // 更新用户的lastPositionUpdate和空的meteoraPositions数组
                user.lastPositionUpdate = new Date()
                user.meteoraPositions = []
                await user.save()
                
                return this.formatError('userNoPositions')
            }

            for (const [poolPk, positionInfo] of userPositions) {
                try {
                    // 遍历这个池子中的所有position
                    for (const positionData of positionInfo.lbPairPositionsData) {
                        const tokenAAmount = positionData.positionData.totalXAmount
                        const tokenBAmount = positionData.positionData.totalYAmount

                        // 获取代币信息 (从poolInfo中获取pair信息)
                        const tokenXInfo = await getTokenInfo(positionInfo.tokenX.publicKey.toBase58())
                        const tokenYInfo = await getTokenInfo(positionInfo.tokenY.publicKey.toBase58())

                        // 格式化代币数量
                        const pooledAmountA = new Decimal(tokenAAmount.toString())
                            .div(10 ** (positionInfo.tokenX.mint.decimals))
                            .toString()
                        const pooledAmountB = new Decimal(tokenBAmount.toString())
                            .div(10 ** (positionInfo.tokenY.mint.decimals))
                            .toString()

                        // 计算代币价值
                        const tokenAPrice = tokenXInfo ? tokenXInfo.price : '0'
                        const tokenBPrice = tokenYInfo ? tokenYInfo.price : '0'
                        const tokenAValue = new Decimal(pooledAmountA).mul(tokenAPrice).toString()
                        const tokenBValue = new Decimal(pooledAmountB).mul(tokenBPrice).toString()

                        // 直接从positionData获取fees和rewards数据
                        const feeX = positionData.positionData.feeX.toString()
                        const feeY = positionData.positionData.feeY.toString()
                        const rewardOne = positionData.positionData.rewardOne.toString()
                        const rewardTwo = positionData.positionData.rewardTwo.toString()

                        // 构建rewards信息数组
                        const rewardsInfos: {
                            mint: string
                            address: string
                            amount: string
                            decimals: number
                            tokenPrice?: string
                            tokenValue?: string
                        }[] = []

                        // 添加Token X的费用奖励
                        if (feeX !== '0') {
                            const feeXAmount = new Decimal(feeX)
                                .div(10 ** positionInfo.tokenX.mint.decimals)
                                .toString()
                            const feeXPrice = tokenXInfo?.price || '0'
                            const feeXValue = new Decimal(feeXAmount).mul(feeXPrice).toString()
                            
                            rewardsInfos.push({
                                mint: tokenXInfo?.symbol.replace(/WSOL/gi, 'SOL') || 'Unknown',
                                address: positionInfo.tokenX.publicKey.toBase58(),
                                amount: feeXAmount,
                                decimals: positionInfo.tokenX.mint.decimals,
                                tokenPrice: feeXPrice,
                                tokenValue: feeXValue
                            })
                        }

                        // 添加Token Y的费用奖励
                        if (feeY !== '0') {
                            const feeYAmount = new Decimal(feeY)
                                .div(10 ** positionInfo.tokenY.mint.decimals)
                                .toString()
                            const feeYPrice = tokenYInfo?.price || '0'
                            const feeYValue = new Decimal(feeYAmount).mul(feeYPrice).toString()
                            
                            rewardsInfos.push({
                                mint: tokenYInfo?.symbol.replace(/WSOL/gi, 'SOL') || 'Unknown',
                                address: positionInfo.tokenY.publicKey.toBase58(),
                                amount: feeYAmount,
                                decimals: positionInfo.tokenY.mint.decimals,
                                tokenPrice: feeYPrice,
                                tokenValue: feeYValue
                            })
                        }

                        // 添加其他奖励代币（如果有）
                        if (rewardOne !== '0' || rewardTwo !== '0') {
                            // 注意：这里需要根据实际的rewardInfos来确定奖励代币的信息
                            // 由于没有直接的代币信息，这部分可能需要额外的API调用或配置
                            console.log('Additional rewards detected but token info not available directly from positionData')
                        }

                        // 获取价格范围信息 (从positionData中获取)
                        const priceLower = `Bin ${positionData.positionData.lowerBinId || 'N/A'}`
                        const priceUpper = `Bin ${positionData.positionData.upperBinId || 'N/A'}`

                        positionsInfo.push({
                            poolId: poolPk,
                            publicKey: user.publicKey,
                            rewardsInfos,
                            tokenAPrice,
                            tokenBPrice,
                            tokenAValue,
                            tokenBValue,
                            displayInfo: {
                                pool: `${tokenXInfo?.symbol.replace(/WSOL/gi, 'SOL') || 'Unknown'} - ${tokenYInfo?.symbol.replace(/WSOL/gi, 'SOL') || 'Unknown'}`,
                                nft: positionData.publicKey.toBase58(),
                                priceLower,
                                priceUpper,
                                pooledAmountA,
                                pooledAmountB
                            }
                        })
                    }
                } catch (positionError) {
                    console.error(`Error processing pool ${poolPk}:`, positionError)
                    continue
                }
            }


            // 更新用户的lastPositionUpdate和meteoraPositions数组
            user.lastPositionUpdate = new Date()
            user.meteoraPositions = positionsInfo
            await user.save()

            console.log(`Updated Meteora positions for user ${telegramId}, found ${positionsInfo.length} positions`)
            
            await ProfitLossService.checkAndApplyProfitLoss(telegramId)
            
            return { positions: positionsInfo }

        } catch (error) {
            const err = error as Error
            console.error('Error in updatePositionInfo:', {
                error,
                message: err.message,
                stack: err.stack
            })
            return this.formatError('updatePositionFailed', { message: err.message })
        }
    }

    /**
     * 获取用户的Meteora position信息（从数据库中获取缓存的数据）
     * 如果数据库中没有数据，则触发一次更新
     */
    static async getUserPositions(telegramId: number): Promise<ServiceResult> {
        try {
            // 查找用户
            const user = await User.findOne({ telegramId })
            if (!user) {
                return this.formatError('userNotFound')
            }

            // 过滤meteoraPositions，只返回publicKey等于user.publicKey的position
            const filteredPositions = user.meteoraPositions?.filter(position => position.publicKey === user.publicKey) || []
            
            // 如果没有过滤后的positions数据，触发一次更新
            if (filteredPositions.length === 0) {
                console.log(`No filtered Meteora positions for user ${telegramId}, triggering update`)
                return await this.updatePositionInfo(telegramId)
            }

            console.log(`Using cached Meteora positions for user ${telegramId}, last updated: ${user.lastPositionUpdate}`)
            return { positions: filteredPositions }

        } catch (error) {
            const err = error as Error
            console.error('Error in getUserPositions:', {
                error,
                message: err.message,
                stack: err.stack
            })
            return this.formatError('getUserPositionsFailed', { message: err.message })
        }
    }

    /**
     * 启动用户的Meteora position定时更新任务
     * 每5分钟更新一次用户的position信息
     */
    static startPositionUpdateTask(telegramId: number): void {
        // 如果已经有定时任务，先清除
        if (this.updateTimers.has(telegramId)) {
            clearInterval(this.updateTimers.get(telegramId)!)
        }

        // 立即执行一次更新
        this.updatePositionInfo(telegramId).catch(err => {
            console.error(`Initial Meteora position update failed for user ${telegramId}:`, err)
        })

        // 设置定时任务，每5分钟更新一次
        const timer = setInterval(() => {
            this.updatePositionInfo(telegramId).catch(err => {
                console.error(`Scheduled Meteora position update failed for user ${telegramId}:`, err)
            })
        }, this.UPDATE_INTERVAL)

        // 保存定时器引用，以便后续可以清除
        this.updateTimers.set(telegramId, timer)
        console.log(`Started Meteora position update task for user ${telegramId}`)
    }

    /**
     * 停止用户的Meteora position定时更新任务
     */
    static stopPositionUpdateTask(telegramId: number): void {
        if (this.updateTimers.has(telegramId)) {
            clearInterval(this.updateTimers.get(telegramId)!)
            this.updateTimers.delete(telegramId)
            console.log(`Stopped Meteora position update task for user ${telegramId}`)
        }
    }

    /**
     * 手动触发更新用户的Meteora position信息
     */
    static async triggerPositionUpdate(telegramId: number): Promise<ServiceResult> {
        return await this.updatePositionInfo(telegramId)
    }

    /**
     * 更新所有用户的Meteora position信息
     * 遍历所有用户并更新他们的position信息
     */
    private static async updateAllUsersPositions(): Promise<void> {
        try {
            console.log('Starting update for all users Meteora positions')
            
            // 获取所有用户
            const users = await User.find({})
            console.log(`Found ${users.length} users to update Meteora positions`)
            
            // 遍历所有用户并更新他们的position信息
            for (const user of users) {
                if (!user.telegramId) continue
                
                try {
                    await this.updatePositionInfo(user.telegramId)
                    console.log(`Updated Meteora positions for user ${user.telegramId}`)
                } catch (err) {
                    console.error(`Failed to update Meteora positions for user ${user.telegramId}:`, err)
                }
            }
            
            console.log('Completed update for all users Meteora positions')
        } catch (error) {
            console.error('Error in updateAllUsersPositions:', error)
        }
    }

    /**
     * 启动全局Meteora position定时更新任务
     * 每5分钟更新一次所有用户的position信息
     */
    static startGlobalPositionUpdateTask(): void {
        // 如果已经有全局定时任务，先清除
        if (this.globalUpdateTimer) {
            clearInterval(this.globalUpdateTimer)
            this.globalUpdateTimer = null
        }

        // 立即执行一次更新
        this.updateAllUsersPositions().catch(err => {
            console.error('Initial global Meteora position update failed:', err)
        })

        // 设置定时任务，每5分钟更新一次所有用户的position信息
        this.globalUpdateTimer = setInterval(() => {
            this.updateAllUsersPositions().catch(err => {
                console.error('Scheduled global Meteora position update failed:', err)
            })
        }, this.UPDATE_INTERVAL)

        console.log('Started global Meteora position update task')
    }

    /**
     * 停止全局Meteora position定时更新任务
     */
    static stopGlobalPositionUpdateTask(): void {
        if (this.globalUpdateTimer) {
            clearInterval(this.globalUpdateTimer)
            this.globalUpdateTimer = null
            console.log('Stopped global Meteora position update task')
        }
    }
}
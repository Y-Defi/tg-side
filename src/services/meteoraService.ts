import { DLMM, PositionInfo as MeteoraPositionInfo } from '@meteora-ag/dlmm'
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

            // 使用Meteora DLMM SDK获取用户positions
            const dlmm = new DLMM(connection)
            
            // 获取用户所有的position账户
            const userPositions = await dlmm.getPositionsByUser(userPublicKey)

            if (!userPositions.length) {
                // 更新用户的lastPositionUpdate和空的meteoraPositions数组
                user.lastPositionUpdate = new Date()
                user.meteoraPositions = []
                await user.save()
                
                return this.formatError('userNoPositions')
            }

            for (const position of userPositions) {
                try {
                    // 获取池信息
                    const pairInfo = await dlmm.getPoolInfo(position.lbPair)
                    if (!pairInfo) {
                        console.log(`Could not fetch pool info for ${position.lbPair.toBase58()}`)
                        continue
                    }

                    // 获取position详细信息
                    const positionInfo = await dlmm.getPositionInfo({
                        userPosition: position.address,
                        lbPair: position.lbPair
                    })

                    if (!positionInfo) {
                        console.log(`Could not fetch position info for ${position.address.toBase58()}`)
                        continue
                    }

                    // 计算position的token数量
                    const { tokenX: tokenAAmount, tokenY: tokenBAmount } = positionInfo.positionData

                    // 获取代币信息
                    const tokenXInfo = await getTokenInfo(pairInfo.tokenXMint.toBase58())
                    const tokenYInfo = await getTokenInfo(pairInfo.tokenYMint.toBase58())

                    // 格式化代币数量
                    const pooledAmountA = new Decimal(tokenAAmount.toString())
                        .div(10 ** (tokenXInfo?.decimals || 6))
                        .toString()
                    const pooledAmountB = new Decimal(tokenBAmount.toString())
                        .div(10 ** (tokenYInfo?.decimals || 6))
                        .toString()

                    // 计算代币价值
                    const tokenAPrice = tokenXInfo ? tokenXInfo.price : '0'
                    const tokenBPrice = tokenYInfo ? tokenYInfo.price : '0'
                    const tokenAValue = new Decimal(pooledAmountA).mul(tokenAPrice).toString()
                    const tokenBValue = new Decimal(pooledAmountB).mul(tokenBPrice).toString()

                    // 获取fees和rewards信息
                    const feesAndRewards = await dlmm.getClaimableFeesAndRewards({
                        userPosition: position.address,
                        lbPair: position.lbPair
                    })

                    // 处理rewards信息
                    const rewardsInfos = []
                    
                    // 添加fee rewards (tokenX和tokenY的fees)
                    if (feesAndRewards.feeX.gt(0)) {
                        const feeXAmount = new Decimal(feesAndRewards.feeX.toString())
                            .div(10 ** (tokenXInfo?.decimals || 6))
                            .toString()
                        const feeXValue = new Decimal(feeXAmount).mul(tokenAPrice).toString()
                        
                        rewardsInfos.push({
                            mint: tokenXInfo?.symbol.replace(/WSOL/gi, 'SOL') || 'Unknown',
                            address: pairInfo.tokenXMint.toBase58(),
                            amount: feeXAmount,
                            decimals: tokenXInfo?.decimals || 6,
                            tokenPrice: tokenAPrice,
                            tokenValue: feeXValue
                        })
                    }

                    if (feesAndRewards.feeY.gt(0)) {
                        const feeYAmount = new Decimal(feesAndRewards.feeY.toString())
                            .div(10 ** (tokenYInfo?.decimals || 6))
                            .toString()
                        const feeYValue = new Decimal(feeYAmount).mul(tokenBPrice).toString()
                        
                        rewardsInfos.push({
                            mint: tokenYInfo?.symbol.replace(/WSOL/gi, 'SOL') || 'Unknown',
                            address: pairInfo.tokenYMint.toBase58(),
                            amount: feeYAmount,
                            decimals: tokenYInfo?.decimals || 6,
                            tokenPrice: tokenBPrice,
                            tokenValue: feeYValue
                        })
                    }

                    // 添加其他rewards
                    if (feesAndRewards.rewards && feesAndRewards.rewards.length > 0) {
                        for (let i = 0; i < feesAndRewards.rewards.length; i++) {
                            const reward = feesAndRewards.rewards[i]
                            if (reward.gt(0)) {
                                // 这里需要获取reward token的信息，但Meteora SDK可能不直接提供
                                // 我们可以尝试从pair信息中获取或者跳过
                                console.log(`Additional reward ${i}: ${reward.toString()}`)
                            }
                        }
                    }

                    // 获取价格范围信息
                    const currentPrice = pairInfo.currentPrice || 0
                    const priceLower = positionInfo.lowerBinId ? `Bin ${positionInfo.lowerBinId}` : 'N/A'
                    const priceUpper = positionInfo.upperBinId ? `Bin ${positionInfo.upperBinId}` : 'N/A'

                    positionsInfo.push({
                        poolId: position.lbPair.toBase58(),
                        publicKey: user.publicKey,
                        rewardsInfos,
                        tokenAPrice,
                        tokenBPrice,
                        tokenAValue,
                        tokenBValue,
                        displayInfo: {
                            pool: `${tokenXInfo?.symbol.replace(/WSOL/gi, 'SOL') || 'Unknown'} - ${tokenYInfo?.symbol.replace(/WSOL/gi, 'SOL') || 'Unknown'}`,
                            nft: position.address.toBase58(),
                            priceLower,
                            priceUpper,
                            pooledAmountA,
                            pooledAmountB
                        }
                    })
                } catch (positionError) {
                    console.error(`Error processing position ${position.address.toBase58()}:`, positionError)
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
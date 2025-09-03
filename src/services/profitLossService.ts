import { User } from '../models/User';
import Decimal from 'decimal.js';
import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';
import { MyContext } from '../types';

interface TakeProfitStopLoss {
    percentage: number;
    targetValue: number;
}

interface Position {
    poolId: string;
    nft: string;
    publicKey: string; 
    initialValue: number;
    takeProfit?: TakeProfitStopLoss;
    stopLoss?: TakeProfitStopLoss;
    createdAt: Date;
    closedAt?: Date;
    triggeredProfit?: boolean;
    triggeredLoss?: boolean;
}

dotenv.config();

export class ProfitLossService {
    private static bot: Telegraf<MyContext>;
    private static botInitialized = false;

    /**
     * 初始化Telegram机器人实例
     * 确保机器人只初始化一次
     */
    static initBot() {
        if (!this.botInitialized && process.env.BOT_TOKEN) {
            this.bot = new Telegraf<MyContext>(process.env.BOT_TOKEN);
            this.botInitialized = true;
            console.log('ProfitLossService: Bot initialized');
        }
    }

    /**
     * 获取机器人实例
     * 如果机器人未初始化，则先初始化
     */
    static getBot(): Telegraf<MyContext> | null {
        if (!this.botInitialized) {
            this.initBot();
        }
        return this.bot || null;
    }

    /**
     * 检查用户的仓位信息，并根据默认止盈止损设置自动应用到新仓位
     * 同时检查已有仓位的止盈止损是否触发
     * @param telegramId 用户的Telegram ID
     */
    static async checkAndApplyProfitLoss(telegramId: number): Promise<void> {
        try {
            // 获取机器人实例（如果需要）
            const bot = this.getBot();
            
            // 查找用户
            const user = await User.findOne({ telegramId });
            if (!user || !user.positions || user.positions.length === 0) {
                console.log(`No positions found for user ${telegramId}`);
                return;
            }

            console.log(`Checking profit/loss settings for user ${telegramId}`);
            
            // 获取用户的仓位信息
            const positions = user.positions.filter(position => position.publicKey === user.publicKey);
            if (positions.length === 0) {
                console.log(`No positions with matching publicKey found for user ${telegramId}`);
                return;
            }

            // 遍历所有仓位
            for (const positionInfo of positions) {
                // 计算仓位的总价值
                const tokenAValue = positionInfo.tokenAValue ? parseFloat(positionInfo.tokenAValue) : 0;
                const tokenBValue = positionInfo.tokenBValue ? parseFloat(positionInfo.tokenBValue) : 0;
                const rewardsValue = positionInfo.rewardsInfos.reduce((total: number, reward: any) => {
                    const tokenValue = reward.tokenValue ? parseFloat(reward.tokenValue) : 0;
                    return total + tokenValue;
                }, 0);
                const totalValue = tokenAValue + tokenBValue + rewardsValue;

                // 检查该仓位是否已经在lpPositions中
                if (user.lpPositions.has(positionInfo.displayInfo.nft)) {
                    // 获取已有仓位
                    const existingPosition = user.lpPositions.get(positionInfo.displayInfo.nft);
                    
                    // 检查止盈是否触发
                    if (existingPosition.takeProfit && 
                        !existingPosition.triggeredProfit && 
                        totalValue >= existingPosition.takeProfit.targetValue) {
                        
                        // 保存触发前的设置信息用于消息通知
                        const takeProfitPercentage = existingPosition.takeProfit.percentage;
                        const takeProfitTargetValue = existingPosition.takeProfit.targetValue;
                        
                        // 更新触发状态
                        existingPosition.triggeredProfit = true;
                        // 删除止盈设置
                        existingPosition.takeProfit = undefined;
                        
                        // 发送通知
                        if (bot) {
                            const lang = user.session?.language || 'en';
                            const message = lang === 'zh' ?
                                `🎯 止盈触发提醒：您的仓位 ${positionInfo.displayInfo.nft} 已达到止盈目标 ${takeProfitPercentage}%！当前价值: $${totalValue.toFixed(2)}` :
                                `🎯 Take Profit Alert: Your position ${positionInfo.displayInfo.nft} has reached the take profit target of ${takeProfitPercentage}%! Current value: $${totalValue.toFixed(2)}`;
                            
                            await bot.telegram.sendMessage(telegramId, message);
                            console.log(`Take profit triggered for user ${telegramId}, position ${positionInfo.displayInfo.nft}`);
                        }
                        
                        // 检查是否需要删除整个仓位
                        if (!existingPosition.stopLoss) {
                            // 如果没有止损设置，删除整个仓位
                            user.lpPositions.delete(positionInfo.displayInfo.nft);
                            console.log(`Removed position ${positionInfo.displayInfo.nft} after take profit triggered`);
                        } else {
                            // 否则更新仓位
                            user.lpPositions.set(positionInfo.displayInfo.nft, existingPosition);
                        }
                        
                        // 确保更改保存到数据库
                        await user.save();
                        console.log(`Saved changes to database after take profit triggered for position ${positionInfo.displayInfo.nft}`);
                    }
                    
                    // 检查止损是否触发
                    if (existingPosition.stopLoss && 
                        !existingPosition.triggeredLoss && 
                        totalValue <= existingPosition.stopLoss.targetValue) {
                        
                        // 保存触发前的设置信息用于消息通知
                        const stopLossPercentage = existingPosition.stopLoss.percentage;
                        const stopLossTargetValue = existingPosition.stopLoss.targetValue;
                        
                        // 更新触发状态
                        existingPosition.triggeredLoss = true;
                        // 删除止损设置
                        existingPosition.stopLoss = undefined;
                        
                        // 发送通知
                        if (bot) {
                            const lang = user.session?.language || 'en';
                            const message = lang === 'zh' ?
                                `⚠️ 止损触发提醒：您的仓位 ${positionInfo.displayInfo.nft} 已达到止损目标 ${stopLossPercentage}%！当前价值: $${totalValue.toFixed(2)}` :
                                `⚠️ Stop Loss Alert: Your position ${positionInfo.displayInfo.nft} has reached the stop loss target of ${stopLossPercentage}%! Current value: $${totalValue.toFixed(2)}`;
                            
                            await bot.telegram.sendMessage(telegramId, message);
                            console.log(`Stop loss triggered for user ${telegramId}, position ${positionInfo.displayInfo.nft}`);
                        }
                        
                        // 检查是否需要删除整个仓位
                        if (!existingPosition.takeProfit) {
                            // 如果没有止盈设置，删除整个仓位
                            user.lpPositions.delete(positionInfo.displayInfo.nft);
                            console.log(`Removed position ${positionInfo.displayInfo.nft} after stop loss triggered`);
                        } else {
                            // 否则更新仓位
                            user.lpPositions.set(positionInfo.displayInfo.nft, existingPosition);
                        }
                        
                        // 确保更改保存到数据库
                        await user.save();
                        console.log(`Saved changes to database after stop loss triggered for position ${positionInfo.displayInfo.nft}`);
                    }
                    
                    console.log(`Position ${positionInfo.displayInfo.nft} already exists in lpPositions`);
                    continue;
                }

                // 检查用户是否设置了默认止盈止损
                if (!user.defaultTakeProfit && !user.defaultStopLoss) {
                    console.log(`User ${telegramId} has no default take profit or stop loss settings`);
                    continue;
                }

                // 创建新的仓位对象
                const newPosition: Position = {
                    poolId: positionInfo.poolId,
                    nft: positionInfo.displayInfo.nft,
                    publicKey: user.publicKey,
                    initialValue: totalValue,
                    createdAt: new Date(),
                    triggeredProfit: false,
                    triggeredLoss: false
                };

                // 如果设置了默认止盈，添加止盈设置
                if (user.defaultTakeProfit && user.defaultTakeProfit > 0) {
                    const takeProfitValue = totalValue * (1 + user.defaultTakeProfit / 100);
                    newPosition.takeProfit = {
                        percentage: user.defaultTakeProfit,
                        targetValue: takeProfitValue
                    };
                    console.log(`Applied take profit ${user.defaultTakeProfit}% to position ${positionInfo.displayInfo.nft}`);
                }

                // 如果设置了默认止损，添加止损设置
                if (user.defaultStopLoss && user.defaultStopLoss > 0) {
                    const stopLossValue = totalValue * (1 - user.defaultStopLoss / 100);
                    newPosition.stopLoss = {
                        percentage: user.defaultStopLoss,
                        targetValue: stopLossValue
                    };
                    console.log(`Applied stop loss ${user.defaultStopLoss}% to position ${positionInfo.displayInfo.nft}`);
                }

                // 将新仓位添加到用户的lpPositions中
                user.lpPositions.set(positionInfo.displayInfo.nft, newPosition);
                console.log(`Added new position ${positionInfo.displayInfo.nft} to lpPositions`);
            }

            // 保存用户数据
            await user.save();
            console.log(`Saved profit/loss settings for user ${telegramId}`);

        } catch (error) {
            const err = error as Error;
            console.error('Error in checkAndApplyProfitLoss:', {
                error,
                message: err.message,
                stack: err.stack
            });
        }
    }
}
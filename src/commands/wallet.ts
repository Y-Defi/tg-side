import { CommandHandler, MyContext } from '../types';
import { Markup } from 'telegraf';
import { User } from '../models/User';

// 验证Solana公钥格式
const isValidSolanaAddress = (address: string): boolean => {
  // Solana地址是44个字符的base58编码字符串
  return /^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(address);
};

// 处理钱包设置按钮回调
const handleWalletSetup = async (ctx: MyContext): Promise<void> => {
  // 初始化session中的尝试次数
  ctx.session.tokenInputAttempts = 0;
  
  // 设置等待输入状态
  ctx.session.waitingForToken = true;
  ctx.session.sessionStartTime = Date.now();
  
  // 提示用户输入地址
  await ctx.reply(ctx.session.language === 'zh' ? 
    '请输入您的Solana钱包地址（公钥）：' : 
    'Please enter your Solana wallet address (Public Key):');
};

// 处理用户输入的公钥
export const handlePublicKeyInput = async (ctx: MyContext, publicKey: string): Promise<void> => {
  // 重置等待状态
  ctx.session.waitingForToken = false;
  
  // 验证地址格式
  if (!isValidSolanaAddress(publicKey)) {
    // 增加尝试次数
    ctx.session.tokenInputAttempts = (ctx.session.tokenInputAttempts || 0) + 1;
    
    // 检查是否超过最大尝试次数
    if (ctx.session.tokenInputAttempts >= 2) {
      await ctx.reply(ctx.session.language === 'zh' ? 
        '无效尝试次数过多。请稍后再试。' : 
        'Too many invalid attempts. Please try again later.');
      return;
    }
    
    // 提示地址无效并重新等待输入
    await ctx.reply(ctx.session.language === 'zh' ? 
      'Solana地址格式无效。请重试。' : 
      'Invalid Solana address format. Please try again.');
    ctx.session.waitingForToken = true;
    ctx.session.sessionStartTime = Date.now();
    return;
  }
  
  try {
    // 获取用户Telegram ID
    const telegramId = ctx.from?.id;
    if (!telegramId) {
      await ctx.reply(ctx.session.language === 'zh' ? 
        '无法获取您的用户信息。请稍后再试。' : 
        'Unable to get your user information. Please try again later.');
      return;
    }
    
    // 查找或创建用户记录
    let user = await User.findOne({ telegramId });
    
    if (user) {
      // 更新现有用户的公钥
      user.publicKey = publicKey;
      await user.save();
    } else {
      // 创建新用户记录
      user = new User({
        telegramId,
        publicKey,
        referralCode: `REF${telegramId}${Math.floor(Math.random() * 1000)}` // 生成随机推荐码
      });
      await user.save();
    }
    
    // 发送成功消息
    await ctx.reply(ctx.session.language === 'zh' ? 
      '钱包地址已成功设置！' : 
      'Wallet address has been successfully set up!');
  } catch (error) {
    console.error('保存钱包地址时出错:', error);
    await ctx.reply(ctx.session.language === 'zh' ? 
      '设置钱包地址失败。请稍后再试。' : 
      'Failed to set up wallet address. Please try again later.');
  }
};

const walletCommand: CommandHandler = {
  command: 'wallet',
  description: 'Show wallet information',
  handler: async (ctx: MyContext, getMessage) => {
    try {
      const lang = ctx.session?.language || 'en';
      // 检查是否在等待用户输入公钥
      if (ctx.session.waitingForToken) {
        // 检查是否超时
        const currentTime = Date.now();
        const startTime = ctx.session.sessionStartTime || 0;
        
        if (currentTime - startTime > 30000) { // 30秒超时
          ctx.session.waitingForToken = false;
          await ctx.reply(getMessage('walletSettings.setupTimeout', lang));
          return;
        }
        
        // 如果是文本消息，可能是用户输入的公钥
        if (ctx.message && 'text' in ctx.message) {
          await handlePublicKeyInput(ctx, ctx.message.text);
        }
        return;
      }
      
      // 获取用户信息
      const telegramId = ctx.from?.id;
      if (!telegramId) {
        await ctx.reply(getMessage('walletSettings.setupFailed', lang));
        return;
      }
      
      const user = await User.findOne({ telegramId });
      
      // 准备回复消息和按钮
      let message = '';
      if (user && user.publicKey) {
        message = `${getMessage('walletSettings.currentWallet', lang)} \n <code>${user.publicKey}</code>`;
      } else {
        message = getMessage('walletSettings.noWallet', lang);
      }
      
      // 添加设置按钮
      await ctx.reply(message, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...Markup.inlineKeyboard([
          Markup.button.callback(getMessage('walletSettings.setupButton', lang), 'setup_wallet')
        ])
      });
    } catch (error) {
      console.error('获取钱包信息时出错:', error);
      const lang = ctx.session?.language || 'en';
      await ctx.reply(getMessage('walletSettings.setupFailed', lang));
    }
  }
};

// 导出命令和回调处理函数
export const handleWalletCallbacks = (bot: any) => {
  bot.action('setup_wallet', async (ctx: MyContext) => {
    await ctx.answerCbQuery();
    await handleWalletSetup(ctx);
  });
  
};

export default walletCommand;
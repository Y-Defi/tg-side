import { CommandHandler, MyContext } from '../types';

const referralCommand: CommandHandler = {
  command: 'referral',
  description: 'Show referral program',
  handler: (ctx: MyContext, getMessage) => {
    const lang = ctx.session?.language || 'en';
    ctx.reply(getMessage('referral', lang));
    // 这里添加推荐计划信息的逻辑
  }
};

export default referralCommand;
import { CommandHandler, MyContext } from '../types';

const helpCommand: CommandHandler = {
  command: 'help',
  description: 'Show help information',
  handler: (ctx: MyContext, getMessage) => {
    const lang = ctx.session?.language || 'en';
    ctx.reply(getMessage('help', lang));
  }
};

export default helpCommand;
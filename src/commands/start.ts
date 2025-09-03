import { CommandHandler, MyContext } from '../types';

const startCommand: CommandHandler = {
  command: 'start',
  description: 'Start the bot',
  handler: (ctx: MyContext, getMessage) => {
    const lang = ctx.session?.language || 'en';
    ctx.reply(getMessage('welcome', lang), {
      parse_mode: 'HTML',
      disable_web_page_preview: true
    });
  }
};

export default startCommand;
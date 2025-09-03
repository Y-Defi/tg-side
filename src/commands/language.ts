import { Markup } from 'telegraf';
import { CommandHandler, MyContext } from '../types';
import { languageSettings } from '../i18n';

const languageCommand: CommandHandler = {
  command: 'language',
  description: 'Change language',
  handler: (ctx: MyContext, getMessage) => {
    ctx.reply('Select language / 选择语言', 
      Markup.inlineKeyboard([
        Markup.button.callback('English', 'lang_en'),
        Markup.button.callback('中文', 'lang_zh')
      ])
    );
  }
};

// 语言选择回调处理
export const handleLanguageCallbacks = (bot: any) => {
  bot.action('lang_en', (ctx: MyContext) => {
    // 将语言设置保存到用户会话中
    ctx.session.language = 'en';
    ctx.answerCbQuery();
    ctx.editMessageText(languageSettings.getMessage('languageChanged', 'en'));
  });

  bot.action('lang_zh', (ctx: MyContext) => {
    // 将语言设置保存到用户会话中
    ctx.session.language = 'zh';
    ctx.answerCbQuery();
    ctx.editMessageText(languageSettings.getMessage('languageChanged', 'zh'));
  });
};

export default languageCommand;
import { CommandHandler } from '../types';
import startCommand from './start';
import helpCommand from './help';
import topPoolsCommand from './topPools';
import meteoraTopPoolsCommand from './meteoraTopPools';
import lpPortfolioCommand from './lpPortfolio';
import walletCommand from './wallet';
import referralCommand from './referral';
import languageCommand, { handleLanguageCallbacks } from './language';
import profitLossCommand, { handleProfitLossCallbacks } from './profitLoss';
import { handleWalletCallbacks } from './wallet';
// 导出所有命令
export const commands: CommandHandler[] = [
  startCommand,
  helpCommand,
  topPoolsCommand,
  meteoraTopPoolsCommand,
  lpPortfolioCommand,
  walletCommand,
  referralCommand,
  languageCommand,
  profitLossCommand
];

export { handleLanguageCallbacks, handleWalletCallbacks, handleProfitLossCallbacks };
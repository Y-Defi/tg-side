import { CommandHandler } from '../types';
import startCommand from './start';
import helpCommand from './help';
import raydiumTopPoolsCommand from './topPools';
import topPoolsCommand from './newTopPools';
import meteoraTopPoolsCommand from './meteoraTopPools';
import orcaTopPoolsCommand from './orcaTopPools';
import raydiumLpPortfolioCommand from './lpPortfolio';
import lpPortfolioCommand from './newLpPortfolio';
import meteoraLpPortfolioCommand, { handleMeteoraeTakeProfitButton, handleMeteoraStopLossButton, handleMeteoraPositionSettingInput } from './meteoraLpPortfolio';
import orcaLpPortfolioCommand, { handleOrcaTakeProfitButton, handleOrcaStopLossButton, handleOrcaPositionSettingInput } from './orcaLpPortfolio';
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
  raydiumTopPoolsCommand,
  meteoraTopPoolsCommand,
  orcaTopPoolsCommand,
  lpPortfolioCommand,
  raydiumLpPortfolioCommand,
  meteoraLpPortfolioCommand,
  orcaLpPortfolioCommand,
  walletCommand,
  referralCommand,
  languageCommand,
  profitLossCommand
];

export { handleLanguageCallbacks, handleWalletCallbacks, handleProfitLossCallbacks, handleMeteoraeTakeProfitButton, handleMeteoraStopLossButton, handleMeteoraPositionSettingInput, handleOrcaTakeProfitButton, handleOrcaStopLossButton, handleOrcaPositionSettingInput };
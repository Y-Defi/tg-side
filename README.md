# LP Telegram Bot

## Overview

LP Telegram Bot is a Telegram bot developed using the Telegraf framework, focused on managing and monitoring Raydium liquidity pools on the Solana blockchain. The bot allows users to view top liquidity pools, manage LP portfolios, set profit/loss targets, and offers multi-language support.

## Features

- **Liquidity Pool Management**: View and manage liquidity pool investments on Raydium
- **Wallet Connection**: Connect Solana wallets to view personal assets and portfolios
- **Profit/Loss Monitoring**: Set take-profit and stop-loss points with automated monitoring
- **Multi-language Support**: Interface available in multiple languages for better user experience
- **Top Pools Display**: Showcase the best-performing liquidity pools on Raydium
- **Referral System**: Built-in referral functionality for users to invite friends

## Tech Stack

- **Backend**: Node.js + TypeScript
- **Telegram API**: Telegraf.js
- **Blockchain Interaction**: Raydium SDK, Solana Web3.js
- **Database**: MongoDB
- **Process Management**: PM2

## Installation & Setup

### Prerequisites

- Node.js (v16+ recommended)
- Yarn package manager
- MongoDB database
- Telegram Bot Token

### Installation Steps

1. Clone the repository

```bash
git clone <repository-url>
cd tg-side
```

2. Install dependencies

```bash
yarn install
```

3. Configure environment variables

Create a `.env` file and add the following configuration:

```
BOT_TOKEN=your_telegram_bot_token
MONGODB_URI=your_mongodb_connection_string
HELIUS_RPC_URL=your_helius_api
```

4. Start the service

```bash
# Development mode
yarn start

# Production mode with PM2
yarn pm2:start
```

## Usage

Search for your bot on Telegram and start it. The following commands are available:

- `/start` - Begin using the bot
- `/help` - Get help information
- `/wallet` - Connect your wallet
- `/topPools` - View top liquidity pools
- `/lpPortfolio` - View and manage LP portfolio
- `/profitLoss` - Set take-profit and stop-loss
- `/referral` - Get referral link
- `/language` - Switch language

## Project Structure

```
src/
├── commands/       # Bot command handlers
├── models/         # Data models
├── services/       # Business logic services
├── config.ts       # Configuration file
├── i18n.ts         # Internationalization support
├── index.ts        # Entry point
└── types.ts        # Type definitions
```

## Maintenance & Management

```bash
# View logs
yarn pm2:logs

# Restart service
yarn pm2:restart

# Stop service
yarn pm2:stop
```

        

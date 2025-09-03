import mongoose, { Schema, Document } from 'mongoose';

export interface IToken extends Document {
  address: string;       // 代币地址/Mint
  symbol: string;        // 代币符号
  decimals: number;      // 小数位数
  price: string;         // 价格
  liquidity: string;     // 流动性
  mcap: string;          // 市值
  lastUpdated: Date;     // 最后更新时间
}

const TokenSchema: Schema = new Schema({
  address: { type: String, required: true, unique: true },
  symbol: { type: String, required: true },
  decimals: { type: Number, required: true },
  price: { type: String, required: true },
  liquidity: { type: String, required: true },
  mcap: { type: String, required: true },
  lastUpdated: { type: Date, default: Date.now }
});

// 创建索引以加快查询速度
// TokenSchema.index({ address: 1 });
TokenSchema.index({ symbol: 1 });

export const Token = mongoose.model<IToken>('Token', TokenSchema);
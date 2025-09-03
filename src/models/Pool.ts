import mongoose, { Schema, Document } from 'mongoose';

interface TokenInfo {
    address: string;
    symbol: string;
    name: string;
    decimals: number;
}

interface DayInfo {
    volume: number;
    apr: number;
    feeApr: number;
    fee24h: number;
}

export interface IPool extends Document {
    id: string;
    mintA: TokenInfo;
    mintB: TokenInfo;
    price: number;
    tvl: number;
    liquidity: number;
    feeRate: number;
    day: DayInfo;
    lastUpdated: Date;
}

const TokenInfoSchema = new Schema({
    address: { type: String, required: true },
    symbol: { type: String, required: true },
    name: { type: String, required: true },
    decimals: { type: Number, required: true }
}, { _id: false });

const DayInfoSchema = new Schema({
    volume: { type: Number, required: true },
    apr: { type: Number, required: true },
    feeApr: { type: Number, required: true },
    fee24h: { type: Number, required: true }
}, { _id: false });

const PoolSchema: Schema = new Schema({
    id: { type: String, required: true, unique: true },
    mintA: { type: TokenInfoSchema, required: true },
    mintB: { type: TokenInfoSchema, required: true },
    price: { type: Number, required: true },
    tvl: { type: Number, required: true },
    liquidity: { type: Number, required: true },
    feeRate: { type: Number, required: true },
    day: { type: DayInfoSchema, required: true },
    lastUpdated: { type: Date, default: Date.now }
});

// 创建索引以加快查询速度
PoolSchema.index({ 'day.apr': -1 });
PoolSchema.index({ tvl: -1 });

export const Pool = mongoose.model<IPool>('Pool', PoolSchema);
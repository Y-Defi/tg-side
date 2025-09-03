import mongoose, { Schema, Document } from 'mongoose';

interface TakeProfitStopLoss {
    percentage: number;
    targetValue: number;
}

interface Position {
    poolId: string;
    nft: string;
    publicKey: string; 
    initialValue: number;
    takeProfit?: TakeProfitStopLoss;
    stopLoss?: TakeProfitStopLoss;
    createdAt: Date;
    closedAt?: Date;      
    triggeredProfit?: boolean;
    triggeredLoss?: boolean;   
}

// 添加PositionInfo接口用于存储Raydium位置信息
interface PositionInfo {
    poolId: string; 
    publicKey: string;
    // poolInfo: any; // 移除
    // rewards: any[]; // 移除
    rewardsInfos: {
        mint: string;
        address: string;
        amount: string;
        decimals: number;
        tokenPrice?: string; 
        tokenValue?: string; 
    }[];
    tokenAPrice?: string; 
    tokenBPrice?: string; 
    tokenAValue?: string; 
    tokenBValue?: string; 
    displayInfo: {
        pool: string;
        nft: string;
        priceLower: string;
        priceUpper: string;
        pooledAmountA: string;
        pooledAmountB: string;
    };
}

export interface IUser extends Document {
    telegramId: number;
    publicKey: string;
    balance: number;
    lpVolume: number;
    referralCode: string;
    referredUsers: number[];
    lpPositions: Map<string, Position>; 
    defaultTakeProfit?: number;  
    defaultStopLoss?: number; 
    autoConvertToSol?: boolean; 
    points: number;
    // 新增字段
    lastPositionUpdate?: Date; // 上次更新positions的时间
    positions?: PositionInfo[]; // 缓存的positions信息
}

const TakeProfitStopLossSchema = new Schema({
    percentage: { type: Number },
    targetValue: { type: Number }
}, { _id: false });

const PositionSchema = new Schema({
    poolId: { type: String, required: true },
    nft: { type: String, required: true },
    publicKey: { type: String, required: true },
    initialValue: { type: Number, required: true },
    takeProfit: { type: TakeProfitStopLossSchema },
    stopLoss: { type: TakeProfitStopLossSchema },
    createdAt: { type: Date, default: Date.now },
    closedAt: { type: Date },
    triggeredProfit: { type: Boolean, default: false },
    triggeredLoss: { type: Boolean, default: false }
}, { _id: false });

// 定义RewardInfoSchema
const RewardInfoSchema = new Schema({
    mint: { type: String, required: true },
    address: { type: String, required: true },
    amount: { type: String, required: true },
    decimals: { type: Number, required: true },
    tokenPrice: { type: String },
    tokenValue: { type: String }
}, { _id: false });

// 定义DisplayInfoSchema
const DisplayInfoSchema = new Schema({
    pool: { type: String, required: true },
    nft: { type: String, required: true },
    priceLower: { type: String, required: true },
    priceUpper: { type: String, required: true },
    pooledAmountA: { type: String, required: true },
    pooledAmountB: { type: String, required: true }
}, { _id: false });

// 定义PositionInfoSchema
const PositionInfoSchema = new Schema({
    poolId: { type: String, required: true }, // 新增字段
    publicKey: { type: String, required: true }, 
    // poolInfo: { type: Schema.Types.Mixed, required: true }, // 移除
    // rewards: { type: [Schema.Types.Mixed], required: true }, // 移除
    rewardsInfos: { type: [RewardInfoSchema], required: true },
    tokenAPrice: { type: String },
    tokenBPrice: { type: String },
    tokenAValue: { type: String },
    tokenBValue: { type: String },
    displayInfo: { type: DisplayInfoSchema, required: true }
}, { _id: false });

const UserSchema: Schema = new Schema({
    telegramId: { type: Number, required: true, unique: true },
    publicKey: { type: String, required: true },
    balance: { type: Number, default: 0 },
    lpVolume: { type: Number, default: 0 },
    referralCode: { type: String, unique: true },
    referredUsers: [{ type: Number }],
    lpPositions: {
        type: Map,
        of: PositionSchema,
        default: () => new Map()  
    },
    defaultTakeProfit: { type: Number, required: false },  
    defaultStopLoss: { type: Number, required: false },
    autoConvertToSol: { type: Boolean, default: false },
    points: { type: Number, default: 0 },
    // 新增字段
    lastPositionUpdate: { type: Date },
    positions: { type: [PositionInfoSchema], default: [] }
});

UserSchema.pre('save', function(next) {
    if (this.lpPositions && !(this.lpPositions instanceof Map)) {
        this.lpPositions = new Map(Object.entries(this.lpPositions));
    }
    next();
});

UserSchema.post('find', function(docs) {
    if (Array.isArray(docs)) {
        docs.forEach(doc => {
            if (doc.lpPositions && !(doc.lpPositions instanceof Map)) {
                doc.lpPositions = new Map(Object.entries(doc.lpPositions));
            }
        });
    }
});

UserSchema.post('findOne', function(doc) {
    if (doc && doc.lpPositions && !(doc.lpPositions instanceof Map)) {
        doc.lpPositions = new Map(Object.entries(doc.lpPositions));
    }
});

export const User = mongoose.model<IUser>('User', UserSchema);
import { Raydium, TxVersion } from '@raydium-io/raydium-sdk-v2'
import { Connection, PublicKey, clusterApiUrl } from '@solana/web3.js'
import dotenv from 'dotenv'
import { User } from './models/User'

dotenv.config()

if (!process.env.HELIUS_RPC_URL) {
    throw new Error('HELIUS_RPC_URL is not defined in .env file')
}

export const connection = new Connection(
    process.env.HELIUS_RPC_URL,
    { commitment: 'confirmed' }
)

export const txVersion = TxVersion.V0

const cluster = 'mainnet'

// 修改Map的键类型为string，用于存储publicKey
const raydiumInstances = new Map<string, Raydium>()

interface InitSdkParams {
    telegramId: number;
    loadToken?: boolean;
}

export const initSdk = async ({ telegramId, loadToken }: InitSdkParams): Promise<Raydium> => {
    try {
        const user = await User.findOne({ telegramId })
        if (!user) {
            throw new Error('User not found or wallet not connected')
        }

        const publicKeyStr = user.publicKey.toString()
        
        // 先检查是否已经有基于publicKey的实例
        const existingInstance = raydiumInstances.get(publicKeyStr)
        if (existingInstance) return existingInstance

        if (connection.rpcEndpoint === clusterApiUrl('mainnet-beta')) {
            console.warn(
                'Using free RPC node might cause unexpected errors. Strongly suggest using a paid RPC node'
            )
        }

        const owner = new PublicKey(publicKeyStr)

        // console.log(`Initializing Raydium SDK for user ${telegramId} with RPC ${connection.rpcEndpoint} in ${cluster}`)

        const raydium = await Raydium.load({
            owner,
            connection,
            cluster,
            disableFeatureCheck: true,
            disableLoadToken: !loadToken,
            blockhashCommitment: 'finalized',
        })

        // 使用publicKey作为键存储实例
        raydiumInstances.set(publicKeyStr, raydium)

        // console.log(`Raydium SDK initialized successfully for user ${telegramId}`)
        return raydium

    } catch (error) {
        console.error('Failed to initialize Raydium SDK:', error)
        throw new Error(`Raydium SDK initialization failed: ${error.message}`)
    }
}


export const clearRaydiumInstance = async (telegramId: number) => {
    const user = await User.findOne({ telegramId })
    if (user) {
        raydiumInstances.delete(user.publicKey.toString())
    }
}

export const getRaydiumInstance = async (telegramId: number): Promise<Raydium | undefined> => {
    const user = await User.findOne({ telegramId })
    if (!user) return undefined
    
    return raydiumInstances.get(user.publicKey.toString())
}

export const CONFIG = {
    MAX_RETRIES: 5,
    BASE_PRIORITY_FEE: 200000,
    PRIORITY_FEE_INCREMENT: 100000,
    RETRY_DELAY: 1000, // ms
};
import { SOLMint, WSOLMint } from '@raydium-io/raydium-sdk-v2'
import { isClient } from '@/utils/common'
import { PublicKey } from '@solana/web3.js'

export const isSol = (mint: string) => mint === SOLMint.toBase58()
export const isWSol = (mint: string) => mint === WSOLMint.toBase58()

export const isSolWSol = (mint1: string, mint2: string) => (isSol(mint1) && isWSol(mint2)) || (isWSol(mint1) && isSol(mint2))

const CACHE_KEY = '_ray_swap_'

export interface PairData {
  inputMint: string
  outputMint: string
}
export const getSwapPairCache = (): PairData => {
  if (!isClient()) return { inputMint: '', outputMint: '' }
  const cache = localStorage.getItem(CACHE_KEY)
  return cache ? JSON.parse(cache) : { inputMint: '', outputMint: '' }
}

export const setSwapPairCache = (params: Partial<PairData>) => {
  if (!isClient()) return
  const currentCache = getSwapPairCache()
  localStorage.setItem(
    CACHE_KEY,
    JSON.stringify({
      ...currentCache,
      ...params
    })
  )
}

export const urlToMint = (mint: string) => {
  if (!mint) return
  if (mint === 'sol') return PublicKey.default.toBase58()
  return mint
}

export const mintToUrl = (mint: string) => {
  if (!mint) return
  if (mint === PublicKey.default.toBase58()) return 'sol'
  return mint
}

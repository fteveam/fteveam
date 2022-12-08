import { PublicKey } from '@solana/web3.js'
import { useEffect } from 'react'

import { useAppStore } from '../store/appStore'

export default function Farm() {
  const raydium = useAppStore((s) => s.raydium)
  const connected = useAppStore((s) => s.connected)

  useEffect(() => {
    async function addFarm() {
      if (!raydium) return
      await raydium.farm.loadHydratedFarmInfo()

      // USDT - USDC farm
      const farmId = '5oCZkR2k955Mvmgq3A4sFd76D5k4qZn45VpaCkp8H3uS'

      const targetFarm = raydium.farm.getParsedFarm(farmId)

      // const { execute, transaction } = await raydium.farm.deposit({
      //   farmId: new PublicKey(farmId),
      // amount: raydium.farm.lpDecimalAmount({
      //   mint: targetFarm.lpMint,
      //   amount: '0.340927',
      // }),
      // })

      // const { execute, transaction } = await raydium.farm.withdraw({
      //   farmId: new PublicKey(farmId),
      //   amount: raydium.farm.lpDecimalAmount({
      //     mint: targetFarm.lpMint,
      //     amount: '0.340927',
      //   }),
      // })

      // usdt-usdc pool: 2EXiumdi14E9b8Fy62QcA5Uh6WdHS2b38wtSxp72Mibj
      // const { execute, transaction, signers } = await raydium.farm.create({
      //   poolId: new PublicKey('2EXiumdi14E9b8Fy62QcA5Uh6WdHS2b38wtSxp72Mibj'),
      //   rewardInfos: [
      //     {
      //       rewardMint: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
      //       rewardPerSecond: 1,
      //       rewardOpenTime: 1661419500,
      //       rewardEndTime: 1662024300,
      //       rewardType: 'Standard SPL',
      //     },
      //   ],
      // })

      // execute()
    }
    connected && addFarm()
  }, [raydium, connected])
  return <div>Farm</div>
}

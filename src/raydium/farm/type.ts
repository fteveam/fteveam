import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

import { BigNumberish } from "@/common/bignumber";
import { FormatFarmInfoOut, ApiV3PoolInfoStandardItem } from "@/api/type";
import { poolTypeV6 } from "./config";

export type RewardType = keyof typeof poolTypeV6;
export interface APIRewardInfo {
  rewardMint: string;
  rewardVault: string;
  rewardOpenTime: number;
  rewardEndTime: number;
  rewardPerSecond: string | number;
  rewardSender?: string;
  rewardType: string;
}

export interface RewardInfoWithKey {
  rewardMint: PublicKey;
  rewardVault: PublicKey;
  rewardOpenTime: number;
  rewardEndTime: number;
  rewardType: RewardType;
  rewardPerSecond: string | number;
  rewardSender?: PublicKey;
}
export interface FarmRewardInfo {
  mint: PublicKey;
  perSecond: string;
  openTime: number;
  endTime: number;
  rewardType: RewardType;
}

export interface FarmRewardInfoConfig {
  isSet: BN;
  rewardPerSecond: BN;
  rewardOpenTime: BN;
  rewardEndTime: BN;
  rewardType: BN;
}

export interface RewardInfoKey {
  rewardMint: PublicKey;
  rewardVault: PublicKey;
  userRewardToken: PublicKey;
}

export interface FarmPoolInfoV6 {
  version: number;
  programId: PublicKey;

  lpMint: PublicKey;

  rewardInfos: FarmRewardInfo[];

  lockInfo: {
    lockMint: PublicKey;
    lockVault: PublicKey;
  };
}

export interface CreateFarm {
  poolInfo: ApiV3PoolInfoStandardItem;
  rewardInfos: FarmRewardInfo[];
  payer?: PublicKey;
  programId?: PublicKey;
}

export interface UpdateFarmReward {
  farmInfo: FormatFarmInfoOut;
  newRewardInfo: FarmRewardInfo;
  payer?: PublicKey;
}
export interface FarmDWParam {
  farmInfo: FormatFarmInfoOut;
  amount: BigNumberish;
  feePayer?: PublicKey;
  useSOLBalance?: boolean;
  associatedOnly?: boolean;
  checkCreateATAOwner?: boolean;
  deposited?: BN;
}
/* ================= pool keys ================= */
export type FarmPoolKeys = {
  readonly id: PublicKey;
  readonly lpMint: PublicKey;
  readonly version: number;
  readonly programId: PublicKey;
  readonly authority: PublicKey;
  readonly lpVault: PublicKey;
  readonly upcoming: boolean;
  readonly rewardInfos: (
    | {
        readonly rewardMint: PublicKey;
        readonly rewardVault: PublicKey;
      }
    | {
        readonly rewardMint: PublicKey;
        readonly rewardVault: PublicKey;
        readonly rewardOpenTime: number;
        readonly rewardEndTime: number;
        readonly rewardPerSecond: number;
        readonly rewardType: RewardType;
      }
  )[];
};

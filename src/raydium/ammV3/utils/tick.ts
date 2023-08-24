import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import Decimal from "decimal.js";

import { getPdaTickArrayAddress } from "./pda";
import { TickMath, SqrtPriceMath } from "./math";
import { AmmV3PoolInfo } from "../type";
// import { ApiV3PoolInfoConcentratedItem } from "../../../api/type";

export const TICK_ARRAY_SIZE = 60;
export const TICK_ARRAY_BITMAP_SIZE = 1024;

export interface ReturnTypeGetTickPrice {
  tick: number;
  price: Decimal;
  tickSqrtPriceX64: BN;
}

export interface ReturnTypeGetPriceAndTick {
  tick: number;
  price: Decimal;
}

export type Tick = {
  tick: number;
  liquidityNet: BN;
  liquidityGross: BN;
  feeGrowthOutsideX64A: BN;
  feeGrowthOutsideX64B: BN;
  rewardGrowthsOutsideX64: BN[];
};

export type TickArray = {
  address: PublicKey;
  poolId: PublicKey;
  startTickIndex: number;
  ticks: Tick[];
  initializedTickCount: number;
};

export type TickState = {
  tick: number;
  liquidityNet: BN;
  liquidityGross: BN;
  feeGrowthOutsideX64A: BN;
  feeGrowthOutsideX64B: BN;
  tickCumulativeOutside: BN;
  secondsPerLiquidityOutsideX64: BN;
  secondsOutside: number;
  rewardGrowthsOutside: BN[];
};

export type TickArrayState = {
  ammPool: PublicKey;
  startTickIndex: number;
  ticks: TickState[];
  initializedTickCount: number;
};

export class TickUtils {
  public static getTickArrayAddressByTick(
    programId: PublicKey,
    poolId: PublicKey,
    tickIndex: number,
    tickSpacing: number,
  ): PublicKey {
    const startIndex = TickUtils.getTickArrayStartIndexByTick(tickIndex, tickSpacing);
    const { publicKey: tickArrayAddress } = getPdaTickArrayAddress(programId, poolId, startIndex);
    return tickArrayAddress;
  }

  public static getTickOffsetInArray(tickIndex: number, tickSpacing: number): number {
    if (tickIndex % tickSpacing != 0) {
      throw new Error("tickIndex % tickSpacing not equal 0");
    }
    const start_tickIndex = TickUtils.getTickArrayStartIndexByTick(tickIndex, tickSpacing);
    const offset_in_array = Math.floor((tickIndex - start_tickIndex) / tickSpacing);
    if (offset_in_array < 0 || offset_in_array >= TICK_ARRAY_SIZE) {
      throw new Error("tick offset in array overflow");
    }
    return offset_in_array;
  }

  public static getTickArrayStartIndexByTick(tickIndex: number, tickSpacing: number): number {
    let startIndex: number = tickIndex / (TICK_ARRAY_SIZE * tickSpacing);
    if (tickIndex < 0 && tickIndex % (TICK_ARRAY_SIZE * tickSpacing) != 0) {
      startIndex = Math.ceil(startIndex) - 1;
    } else {
      startIndex = Math.floor(startIndex);
    }
    return startIndex * (tickSpacing * TICK_ARRAY_SIZE);
  }

  public static getTickArrayOffsetInBitmapByTick(tick: number, tickSpacing: number): number {
    const multiplier = tickSpacing * TICK_ARRAY_SIZE;
    const compressed = Math.floor(tick / multiplier) + 512;
    return Math.abs(compressed);
  }

  public static checkTickArrayIsInitialized(
    bitmap: BN,
    tick: number,
    tickSpacing: number,
  ): { isInitialized: boolean; startIndex: number } {
    const multiplier = tickSpacing * TICK_ARRAY_SIZE;
    const compressed = Math.floor(tick / multiplier) + 512;
    const bit_pos = Math.abs(compressed);
    return {
      isInitialized: bitmap.testn(bit_pos),
      startIndex: (bit_pos - 512) * multiplier,
    };
  }

  public static getNextTickArrayStartIndex(
    lastTickArrayStartIndex: number,
    tickSpacing: number,
    zeroForOne: boolean,
  ): number {
    return zeroForOne
      ? lastTickArrayStartIndex - tickSpacing * TICK_ARRAY_SIZE
      : lastTickArrayStartIndex + tickSpacing * TICK_ARRAY_SIZE;
  }

  public static mergeTickArrayBitmap(bns: BN[]): BN {
    return bns[0]
      .add(bns[1].shln(64))
      .add(bns[2].shln(128))
      .add(bns[3].shln(192))
      .add(bns[4].shln(256))
      .add(bns[5].shln(320))
      .add(bns[6].shln(384))
      .add(bns[7].shln(448))
      .add(bns[8].shln(512))
      .add(bns[9].shln(576))
      .add(bns[10].shln(640))
      .add(bns[11].shln(704))
      .add(bns[12].shln(768))
      .add(bns[13].shln(832))
      .add(bns[14].shln(896))
      .add(bns[15].shln(960));
  }

  public static getInitializedTickArrayInRange(
    tickArrayBitmap: BN,
    tickSpacing: number,
    tickArrayStartIndex: number,
    expectedCount: number,
  ): number[] {
    if (tickArrayStartIndex % (tickSpacing * TICK_ARRAY_SIZE) != 0) {
      throw new Error("Invild tickArrayStartIndex");
    }
    const tickArrayOffset = Math.floor(tickArrayStartIndex / (tickSpacing * TICK_ARRAY_SIZE)) + 512;
    return [
      // find right of currenct offset
      ...TickUtils.searchLowBitFromStart(tickArrayBitmap, tickArrayOffset - 1, 0, expectedCount, tickSpacing),

      // find left of current offset
      ...TickUtils.searchHightBitFromStart(
        tickArrayBitmap,
        tickArrayOffset,
        TICK_ARRAY_BITMAP_SIZE,
        expectedCount,
        tickSpacing,
      ),
    ];
  }

  public static getAllInitializedTickArrayStartIndex(tickArrayBitmap: BN, tickSpacing: number): number[] {
    // find from offset 0 to 1024
    return TickUtils.searchHightBitFromStart(
      tickArrayBitmap,
      0,
      TICK_ARRAY_BITMAP_SIZE,
      TICK_ARRAY_BITMAP_SIZE,
      tickSpacing,
    );
  }

  public static getAllInitializedTickArrayInfo(
    programId: PublicKey,
    poolId: PublicKey,
    tickArrayBitmap: BN,
    tickSpacing: number,
  ): {
    tickArrayStartIndex: number;
    tickArrayAddress: PublicKey;
  }[] {
    const result: {
      tickArrayStartIndex: number;
      tickArrayAddress: PublicKey;
    }[] = [];
    const allInitializedTickArrayIndex: number[] = TickUtils.getAllInitializedTickArrayStartIndex(
      tickArrayBitmap,
      tickSpacing,
    );
    for (const startIndex of allInitializedTickArrayIndex) {
      const { publicKey: address } = getPdaTickArrayAddress(programId, poolId, startIndex);
      result.push({
        tickArrayStartIndex: startIndex,
        tickArrayAddress: address,
      });
    }
    return result;
  }

  public static getAllInitializedTickInTickArray(tickArray: TickArrayState): TickState[] {
    return tickArray.ticks.filter((i) => i.liquidityGross.gtn(0));
  }

  public static searchLowBitFromStart(
    tickArrayBitmap: BN,
    start: number,
    end: number,
    expectedCount: number,
    tickSpacing: number,
  ): number[] {
    let fetchNum = 0;
    const result: number[] = [];
    for (let i = start; i >= end; i--) {
      if (tickArrayBitmap.shrn(i).and(new BN(1)).eqn(1)) {
        const nextStartIndex = (i - 512) * (tickSpacing * TICK_ARRAY_SIZE);
        result.push(nextStartIndex);
        fetchNum++;
      }
      if (fetchNum >= expectedCount) {
        break;
      }
    }
    return result;
  }

  public static searchHightBitFromStart(
    tickArrayBitmap: BN,
    start: number,
    end: number,
    expectedCount: number,
    tickSpacing: number,
  ): number[] {
    let fetchNum = 0;
    const result: number[] = [];
    for (let i = start; i < end; i++) {
      if (tickArrayBitmap.shrn(i).and(new BN(1)).eqn(1)) {
        const nextStartIndex = (i - 512) * (tickSpacing * TICK_ARRAY_SIZE);
        result.push(nextStartIndex);
        fetchNum++;
      }
      if (fetchNum >= expectedCount) {
        break;
      }
    }
    return result;
  }

  static getTickPrice({
    poolInfo,
    tick,
    baseIn,
  }: {
    poolInfo: AmmV3PoolInfo;
    tick: number;
    baseIn: boolean;
  }): ReturnTypeGetTickPrice {
    const tickSqrtPriceX64 = SqrtPriceMath.getSqrtPriceX64FromTick(tick);
    const tickPrice = SqrtPriceMath.sqrtPriceX64ToPrice(
      tickSqrtPriceX64,
      poolInfo.mintA.decimals,
      poolInfo.mintB.decimals,
    );

    return baseIn
      ? { tick, price: tickPrice, tickSqrtPriceX64 }
      : { tick, price: new Decimal(1).div(tickPrice), tickSqrtPriceX64 };
  }
  static getPriceAndTick({
    poolInfo,
    price,
    baseIn,
  }: {
    poolInfo: AmmV3PoolInfo;
    price: Decimal;
    baseIn: boolean;
  }): ReturnTypeGetPriceAndTick {
    const _price = baseIn ? price : new Decimal(1).div(price);

    const tick = TickMath.getTickWithPriceAndTickspacing(
      _price,
      poolInfo.ammConfig.tickSpacing,
      poolInfo.mintA.decimals,
      poolInfo.mintB.decimals,
    );
    const tickSqrtPriceX64 = SqrtPriceMath.getSqrtPriceX64FromTick(tick);
    const tickPrice = SqrtPriceMath.sqrtPriceX64ToPrice(
      tickSqrtPriceX64,
      poolInfo.mintA.decimals,
      poolInfo.mintB.decimals,
    );

    return baseIn ? { tick, price: tickPrice } : { tick, price: new Decimal(1).div(tickPrice) };
  }

  /** new method for api return */
  // static getTickPriceV2({
  //   poolInfo,
  //   tick,
  //   baseIn,
  // }: {
  //   poolInfo: ApiV3PoolInfoConcentratedItem;
  //   tick: number;
  //   baseIn: boolean;
  // }): ReturnTypeGetTickPrice {
  //   const tickSqrtPriceX64 = SqrtPriceMath.getSqrtPriceX64FromTick(tick);
  //   const tickPrice = SqrtPriceMath.sqrtPriceX64ToPrice(
  //     tickSqrtPriceX64,
  //     poolInfo.mintA.decimals,
  //     poolInfo.mintB.decimals,
  //   );

  //   return baseIn
  //     ? { tick, price: tickPrice, tickSqrtPriceX64 }
  //     : { tick, price: new Decimal(1).div(tickPrice), tickSqrtPriceX64 };
  // }

  // static getPriceAndTickV2({
  //   poolInfo,
  //   price,
  //   baseIn,
  // }: {
  //   poolInfo: ApiV3PoolInfoConcentratedItem;
  //   price: Decimal;
  //   baseIn: boolean;
  // }): ReturnTypeGetPriceAndTick {
  //   const _price = baseIn ? price : new Decimal(1).div(price);

  //   const tick = TickMath.getTickWithPriceAndTickspacing(
  //     _price,
  //     // poolInfo.ammConfig.tickSpacing,
  //     4, // to do fix
  //     poolInfo.mintA.decimals,
  //     poolInfo.mintB.decimals,
  //   );
  //   const tickSqrtPriceX64 = SqrtPriceMath.getSqrtPriceX64FromTick(tick);
  //   const tickPrice = SqrtPriceMath.sqrtPriceX64ToPrice(
  //     tickSqrtPriceX64,
  //     poolInfo.mintA.decimals,
  //     poolInfo.mintB.decimals,
  //   );

  //   return baseIn ? { tick, price: tickPrice } : { tick, price: new Decimal(1).div(tickPrice) };
  // }
}

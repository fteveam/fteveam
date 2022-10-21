import { PublicKey } from "@solana/web3.js";
import Decimal from "decimal.js";
import {
  toPercent,
  toFraction,
  decimalToFraction,
  toUsdCurrency,
  BigNumberish,
  recursivelyDecimalToFraction,
} from "../../common/bignumber";
import { SOLMint, WSOLMint } from "../../common";
import { add, mul, div } from "../../common/fractionUtil";
import ModuleBase, { ModuleBaseProps } from "../moduleBase";
import { Token } from "../../module/token";
import { TokenAmount } from "../../module/amount";
import { Price } from "../../module/price";
import { Percent } from "../../module/percent";
import { mockCreatePoolInfo, MAX_SQRT_PRICE_X64, MIN_SQRT_PRICE_X64, ONE } from "./utils/constants";
import { LiquidityMath, SqrtPriceMath, TickMath } from "./utils/math";
import { PoolUtils } from "./utils/pool";
import { PositionUtils } from "./utils/position";
import { TickArray } from "./utils/tick";
import {
  CreateConcentratedPool,
  AmmV3PoolInfo,
  ApiAmmV3PoolInfo,
  UserPositionAccount,
  HydratedConcentratedInfo,
  SDKParsedConcentratedInfo,
  IncreaseLiquidity,
  AmmV3PoolPersonalPosition,
  OpenPosition,
  ReturnTypeGetAmountsFromLiquidity,
  ReturnTypeComputeAmountOutFormat,
  ReturnTypeComputeAmountOut,
} from "./type";
import { AmmV3Instrument } from "./instrument";
import { LoadParams, MakeTransaction } from "../type";
import BN from "bn.js";
import { TOKEN_SOL } from "../token";
export class AmmV3 extends ModuleBase {
  private _ammV3Pools: ApiAmmV3PoolInfo[] = [];
  private _ammV3PoolMap: Map<string, ApiAmmV3PoolInfo> = new Map();
  private _ammV3SdkParsedPools: SDKParsedConcentratedInfo[] = [];
  private _ammV3SdkParsedPoolMap: Map<string, SDKParsedConcentratedInfo> = new Map();
  private _hydratedAmmV3Pools: HydratedConcentratedInfo[] = [];
  private _hydratedAmmV3PoolsMap: Map<string, HydratedConcentratedInfo> = new Map();
  constructor(params: ModuleBaseProps) {
    super(params);
  }

  public async load(params?: LoadParams): Promise<void> {
    await this.scope.token.load(params);
    await this.scope.fetchAmmV3Pools();
    this._ammV3Pools = [...(this.scope.apiData.ammV3Pools?.data || [])];
    this._ammV3Pools.forEach((pool) => {
      this._ammV3PoolMap.set(pool.id, pool);
    });

    const chainTimeOffset = await this.scope.chainTimeOffset();

    const sdkParsed = await PoolUtils.fetchMultiplePoolInfos({
      poolKeys: this._ammV3Pools,
      connection: this.scope.connection,
      ownerInfo: this.scope.owner
        ? { tokenAccounts: this.scope.account.tokenAccountRawInfos, wallet: this.scope.ownerPubKey }
        : undefined,
      chainTime: (Date.now() + chainTimeOffset) / 1000,
    });
    this._ammV3SdkParsedPools = Object.values(sdkParsed);
    this._ammV3SdkParsedPoolMap = new Map(Object.entries(sdkParsed));

    this.hydratePoolsInfo();
  }

  get pools(): {
    data: ApiAmmV3PoolInfo[];
    dataMap: Map<string, ApiAmmV3PoolInfo>;
    sdkParsedData: SDKParsedConcentratedInfo[];
    sdkParsedDataMap: Map<string, SDKParsedConcentratedInfo>;
    hydratedData: HydratedConcentratedInfo[];
    hydratedDataData: Map<string, HydratedConcentratedInfo>;
  } {
    return {
      data: this._ammV3Pools,
      dataMap: this._ammV3PoolMap,
      sdkParsedData: this._ammV3SdkParsedPools,
      sdkParsedDataMap: this._ammV3SdkParsedPoolMap,
      hydratedData: this._hydratedAmmV3Pools,
      hydratedDataData: this._hydratedAmmV3PoolsMap,
    };
  }

  public hydratePoolsInfo(): HydratedConcentratedInfo[] {
    this._hydratedAmmV3Pools = this._ammV3SdkParsedPools.map((pool) => {
      const rewardLength = pool.state.rewardInfos.length;
      const [base, quote] = [
        this.scope.token.allTokenMap.get(pool.state.mintA.mint.toBase58()),
        this.scope.token.allTokenMap.get(pool.state.mintB.mint.toBase58()),
      ];
      const currentPrice = decimalToFraction(pool.state.currentPrice)!;
      const toMintATokenAmount = (amount: BigNumberish, decimalDone = true): TokenAmount | undefined =>
        base ? this.scope.mintToTokenAmount({ mint: base.mint, amount, decimalDone }) : undefined;
      const toMintBTokenAmount = (amount: BigNumberish, decimalDone = true): TokenAmount | undefined =>
        quote ? this.scope.mintToTokenAmount({ mint: quote.mint, amount, decimalDone }) : undefined;

      const parseReward = (time: "day" | "week" | "month"): Percent[] =>
        [
          toPercent(pool.state[time].rewardApr.A, { alreadyDecimaled: true }),
          toPercent(pool.state[time].rewardApr.B, { alreadyDecimaled: true }),
          toPercent(pool.state[time].rewardApr.C, { alreadyDecimaled: true }),
        ].slice(0, rewardLength);

      return {
        ...pool,
        id: pool.state.id,
        base,
        quote,
        name: (base ? base.symbol : "unknown") + "-" + (quote ? quote?.symbol : "unknown"),
        protocolFeeRate: toPercent(toFraction(pool.state.ammConfig.protocolFeeRate).div(toFraction(10 ** 4)), {
          alreadyDecimaled: true,
        }),
        tradeFeeRate: toPercent(toFraction(pool.state.ammConfig.tradeFeeRate).div(toFraction(10 ** 4)), {
          alreadyDecimaled: true,
        }),
        creator: pool.state.creator,
        ammConfig: pool.state.ammConfig,
        currentPrice,

        idString: pool.state.id.toBase58(),
        tvl: toUsdCurrency(pool.state.tvl),

        totalApr24h: toPercent(pool.state.day.apr, { alreadyDecimaled: true }),
        totalApr7d: toPercent(pool.state.week.apr, { alreadyDecimaled: true }),
        totalApr30d: toPercent(pool.state.month.apr, { alreadyDecimaled: true }),
        feeApr24h: toPercent(pool.state.day.feeApr, { alreadyDecimaled: true }),
        feeApr7d: toPercent(pool.state.week.feeApr, { alreadyDecimaled: true }),
        feeApr30d: toPercent(pool.state.month.feeApr, { alreadyDecimaled: true }),
        rewardApr24h: parseReward("day"),
        rewardApr7d: parseReward("week"),
        rewardApr30d: parseReward("month"),

        volume24h: toUsdCurrency(pool.state.day.volume),
        volume7d: toUsdCurrency(pool.state.week.volume),
        volume30d: toUsdCurrency(pool.state.month.volume),

        volumeFee24h: toUsdCurrency(pool.state.day.volumeFee),
        volumeFee7d: toUsdCurrency(pool.state.week.volumeFee),
        volumeFee30d: toUsdCurrency(pool.state.month.volumeFee),

        fee24hA: toMintATokenAmount(pool.state.day.feeA),
        fee24hB: toMintBTokenAmount(pool.state.day.feeB),
        fee7dA: toMintATokenAmount(pool.state.week.feeA),
        fee7dB: toMintBTokenAmount(pool.state.week.feeB),
        fee30dA: toMintATokenAmount(pool.state.month.feeA),
        fee30dB: toMintBTokenAmount(pool.state.month.feeB),

        userPositionAccount: pool.positionAccount?.map((a) => {
          const amountA = toMintATokenAmount(a.amountA, false);
          const amountB = toMintATokenAmount(a.amountB, false);
          const tokenFeeAmountA = toMintATokenAmount(a.tokenFeeAmountA, false);
          const tokenFeeAmountB = toMintATokenAmount(a.tokenFeeAmountB, false);
          const innerVolumeA = mul(currentPrice, amountA) || 0;
          const innerVolumeB = mul(currentPrice, amountB) || 0;
          const positionPercentA = toPercent(div(innerVolumeA, add(innerVolumeA, innerVolumeB))!);
          const positionPercentB = toPercent(div(innerVolumeB, add(innerVolumeA, innerVolumeB))!);
          const inRange = PositionUtils.checkIsInRange(pool, a);
          const poolRewardInfos = pool.state.rewardInfos;
          return {
            sdkParsed: a,
            ...recursivelyDecimalToFraction(a),
            amountA,
            amountB,
            nftMint: a.nftMint, // need this or nftMint will be buggy, this is only quick fixed
            liquidity: a.liquidity,
            tokenA: base,
            tokenB: quote,
            positionPercentA,
            positionPercentB,
            tokenFeeAmountA,
            tokenFeeAmountB,
            inRange,
            rewardInfos: a.rewardInfos
              .map((info, idx) => {
                const token = this.scope.token.allTokenMap.get(poolRewardInfos[idx]?.tokenMint.toBase58());
                const penddingReward = token
                  ? this.scope.mintToTokenAmount({ mint: token.mint, amount: info.peddingReward })
                  : undefined;
                if (!penddingReward) return;
                const apr24h =
                  idx === 0
                    ? toPercent(pool.state.day.rewardApr.A, { alreadyDecimaled: true })
                    : idx === 1
                    ? toPercent(pool.state.day.rewardApr.B, { alreadyDecimaled: true })
                    : toPercent(pool.state.day.rewardApr.C, { alreadyDecimaled: true });
                const apr7d =
                  idx === 0
                    ? toPercent(pool.state.week.rewardApr.A, { alreadyDecimaled: true })
                    : idx === 1
                    ? toPercent(pool.state.week.rewardApr.B, { alreadyDecimaled: true })
                    : toPercent(pool.state.week.rewardApr.C, { alreadyDecimaled: true });
                const apr30d =
                  idx === 0
                    ? toPercent(pool.state.month.rewardApr.A, { alreadyDecimaled: true })
                    : idx === 1
                    ? toPercent(pool.state.month.rewardApr.B, { alreadyDecimaled: true })
                    : toPercent(pool.state.month.rewardApr.C, { alreadyDecimaled: true });
                return { penddingReward, apr24h, apr7d, apr30d };
              })
              .filter((info) => Boolean(info?.penddingReward)) as UserPositionAccount["rewardInfos"],
            getLiquidityVolume: (): any => {
              const aPrice = this.scope.token.tokenPrices.get(pool.state.mintA.mint.toBase58());
              const bPrice = this.scope.token.tokenPrices.get(pool.state.mintB.mint.toBase58());
              const wholeLiquidity = add(mul(amountA, aPrice), mul(amountB, bPrice));
              return {
                wholeLiquidity,
                baseLiquidity: mul(wholeLiquidity, positionPercentA),
                quoteLiquidity: mul(wholeLiquidity, positionPercentB),
              };
            },
          };
        }),

        rewardInfos: pool.state.rewardInfos.map((r) => {
          const rewardToken = this.scope.token.allTokenMap.get(r.tokenMint.toBase58());
          return {
            ...r,
            rewardToken,
            openTime: r.openTime.toNumber() * 1000,
            endTime: r.endTime.toNumber() * 1000,
            lastUpdateTime: r.lastUpdateTime.toNumber() * 1000,
            creator: r.creator,
            rewardClaimed: rewardToken
              ? this.scope.mintToTokenAmount({ mint: r.tokenMint, amount: r.rewardClaimed })
              : undefined,
            rewardTotalEmissioned: rewardToken
              ? this.scope.mintToTokenAmount({ mint: r.tokenMint, amount: r.rewardTotalEmissioned })
              : undefined,
          };
        }),
      };
    });
    this._hydratedAmmV3PoolsMap = new Map(this._hydratedAmmV3Pools.map((pool) => [pool.idString, pool]));
    return this._hydratedAmmV3Pools;
  }

  public async fetchPoolAccountPosition(): Promise<HydratedConcentratedInfo[]> {
    this.scope.checkOwner();
    await this.scope.account.fetchWalletTokenAccounts();
    this._ammV3SdkParsedPools = await PoolUtils.fetchPoolsAccountPosition({
      pools: this._ammV3SdkParsedPools,
      connection: this.scope.connection,
      ownerInfo: { tokenAccounts: this.scope.account.tokenAccountRawInfos, wallet: this.scope.ownerPubKey },
    });
    this._ammV3SdkParsedPoolMap = new Map(this._ammV3SdkParsedPools.map((pool) => [pool.state.id.toBase58(), pool]));
    this.hydratePoolsInfo();
    return this._hydratedAmmV3Pools;
  }

  public async createPool(
    props: CreateConcentratedPool,
  ): Promise<Omit<MakeTransaction, "extInfo"> & { extInfo: AmmV3PoolInfo }> {
    const { programId, owner = this.scope.ownerPubKey, mint1, mint2, ammConfig, initialPrice } = props;
    const txBuilder = this.createTxBuilder();
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const [mintA, mintB, initPrice] = mint1.mint._bn.gt(mint2.mint._bn)
      ? [mint2, mint1, new Decimal(1).div(initialPrice)]
      : [mint1, mint2, initialPrice];

    const initialPriceX64 = SqrtPriceMath.priceToSqrtPriceX64(initPrice, mintA.decimals, mintB.decimals);

    const insInfo = await AmmV3Instrument.createPoolInstructions({
      connection: this.scope.connection,
      programId,
      owner,
      mintA,
      mintB,
      ammConfigId: ammConfig.id,
      initialPriceX64,
    });

    txBuilder.addInstruction({
      signers: insInfo.signers,
      instructions: [AmmV3Instrument.addComputations(), ...insInfo.instructions],
    });

    return txBuilder.build({
      mockPoolInfo: {
        id: insInfo.address.poolId,
        mintA: {
          mint: mintA.mint,
          vault: insInfo.address.mintAVault,
          decimals: mintA.decimals,
        },
        mintB: {
          mint: mintB.mint,
          vault: insInfo.address.mintBVault,
          decimals: mintB.decimals,
        },
        ammConfig,
        observationId: insInfo.address.observationId,
        programId,
        tickSpacing: ammConfig.tickSpacing,
        sqrtPriceX64: initialPriceX64,
        currentPrice: initPrice,
        ...mockCreatePoolInfo,
      },
    }) as Omit<MakeTransaction, "extInfo"> & { extInfo: AmmV3PoolInfo };
  }

  public async openPosition({
    poolId,
    ownerInfo,
    tickLower,
    tickUpper,
    liquidity,
    slippage,
    associatedOnly = true,
  }: OpenPosition): Promise<MakeTransaction> {
    this.scope.checkOwner();
    const pool = this._hydratedAmmV3PoolsMap.get(poolId.toBase58());
    if (!pool) this.logAndCreateError("pool not found:", poolId.toBase58());
    const poolInfo = pool!.state;
    const { amountSlippageA, amountSlippageB } = LiquidityMath.getAmountsFromLiquidityWithSlippage(
      poolInfo.sqrtPriceX64,
      SqrtPriceMath.getSqrtPriceX64FromTick(tickLower),
      SqrtPriceMath.getSqrtPriceX64FromTick(tickUpper),
      liquidity,
      true,
      true,
      slippage,
    );
    const txBuilder = this.createTxBuilder();
    txBuilder.addInstruction({ instructions: [AmmV3Instrument.addComputations()] });

    let ownerTokenAccountA: PublicKey | null = null;
    let ownerTokenAccountB: PublicKey | null = null;
    const mintAUseSOLBalance = ownerInfo.useSOLBalance && poolInfo.mintA.mint.equals(WSOLMint);
    const mintBUseSOLBalance = ownerInfo.useSOLBalance && poolInfo.mintB.mint.equals(WSOLMint);
    const { account: _ownerTokenAccountA, instructionParams: _tokenAccountAInstruction } =
      await this.scope.account.getOrCreateTokenAccount({
        mint: poolInfo.mintA.mint,
        owner: this.scope.ownerPubKey,

        createInfo: mintAUseSOLBalance
          ? {
              payer: this.scope.ownerPubKey,
              amount: amountSlippageA,
            }
          : undefined,

        notUseTokenAccount: mintAUseSOLBalance,
        associatedOnly: mintAUseSOLBalance ? false : associatedOnly,
      });
    if (_ownerTokenAccountA) ownerTokenAccountA = _ownerTokenAccountA;
    txBuilder.addInstruction(_tokenAccountAInstruction || {});

    const { account: _ownerTokenAccountB, instructionParams: _tokenAccountBInstruction } =
      await this.scope.account.getOrCreateTokenAccount({
        mint: poolInfo.mintB.mint,
        owner: this.scope.ownerPubKey,

        createInfo: mintBUseSOLBalance
          ? {
              payer: this.scope.ownerPubKey!,
              amount: amountSlippageA,
            }
          : undefined,
        notUseTokenAccount: mintBUseSOLBalance,
        associatedOnly: mintBUseSOLBalance ? false : associatedOnly,
      });
    if (_ownerTokenAccountB) ownerTokenAccountB = _ownerTokenAccountB;
    txBuilder.addInstruction(_tokenAccountBInstruction || {});

    if (!ownerTokenAccountA || !ownerTokenAccountB)
      this.logAndCreateError("cannot found target token accounts", "tokenAccounts", this.scope.account.tokenAccounts);

    const insInfo = await AmmV3Instrument.openPositionInstructions({
      poolInfo,
      ownerInfo: {
        ...ownerInfo,
        feePayer: this.scope.ownerPubKey,
        wallet: this.scope.ownerPubKey,
        tokenAccountA: ownerTokenAccountA!,
        tokenAccountB: ownerTokenAccountB!,
      },
      tickLower,
      tickUpper,
      liquidity,
      amountSlippageA,
      amountSlippageB,
    });
    txBuilder.addInstruction({ instructions: insInfo.instructions, signers: insInfo.signers });

    return txBuilder.build();
  }

  public async increaseLiquidity(props: IncreaseLiquidity): Promise<MakeTransaction> {
    const { poolId, ownerPosition, liquidity, slippage, ownerInfo } = props;
    const pool = this._hydratedAmmV3PoolsMap.get(poolId.toBase58());
    if (!pool) this.logAndCreateError("pool not found: ", poolId.toBase58());

    const poolInfo = pool!.state;
    const txBuilder = this.createTxBuilder();
    txBuilder.addInstruction({ instructions: [AmmV3Instrument.addComputations()] });
    const { amountSlippageA, amountSlippageB } = LiquidityMath.getAmountsFromLiquidityWithSlippage(
      poolInfo.sqrtPriceX64,
      SqrtPriceMath.getSqrtPriceX64FromTick(ownerPosition.tickLower),
      SqrtPriceMath.getSqrtPriceX64FromTick(ownerPosition.tickUpper),
      liquidity,
      true,
      true,
      slippage,
    );
    let ownerTokenAccountA: PublicKey | undefined = undefined;
    let ownerTokenAccountB: PublicKey | undefined = undefined;

    const { tokenAccount: _ownerTokenAccountA, ...accountAInstructions } = await this.scope.account.processTokenAccount(
      { mint: poolInfo.mintA.mint, amount: amountSlippageA, useSOLBalance: ownerInfo.useSOLBalance },
    );
    ownerTokenAccountA = _ownerTokenAccountA;
    txBuilder.addInstruction(accountAInstructions);

    const { tokenAccount: _ownerTokenAccountB, ...accountBInstructions } = await this.scope.account.processTokenAccount(
      { mint: poolInfo.mintB.mint, amount: amountSlippageB, useSOLBalance: ownerInfo.useSOLBalance },
    );
    ownerTokenAccountB = _ownerTokenAccountB;
    txBuilder.addInstruction(accountBInstructions);

    if (!ownerTokenAccountA && !ownerTokenAccountB)
      this.logAndCreateError("cannot found target token accounts", "tokenAccounts", this.scope.account.tokenAccounts);

    txBuilder.addInstruction({
      instructions: (
        await AmmV3Instrument.makeIncreaseLiquidityInstructions({
          poolInfo,
          ownerPosition,
          ownerInfo: {
            wallet: this.scope.ownerPubKey,
            tokenAccountA: ownerTokenAccountA!,
            tokenAccountB: ownerTokenAccountB!,
          },
          liquidity,
          amountSlippageA,
          amountSlippageB,
        })
      ).instructions,
    });

    return txBuilder.build();
  }

  public async decreaseLiquidity(props: IncreaseLiquidity): Promise<MakeTransaction> {
    const {
      poolId,
      ownerPosition,
      ownerInfo,
      amountMinA,
      amountMinB,
      liquidity,
      slippage,
      associatedOnly = true,
    } = props;
    const pool = this._hydratedAmmV3PoolsMap.get(poolId.toBase58());
    if (!pool) this.logAndCreateError("pool not found: ", poolId.toBase58());
    const poolInfo = pool!.state;

    const txBuilder = this.createTxBuilder();
    txBuilder.addInstruction({ instructions: [AmmV3Instrument.addComputations()] });

    let _amountMinA: BN;
    let _amountMinB: BN;

    if (amountMinA !== undefined && amountMinB !== undefined) {
      _amountMinA = amountMinA;
      _amountMinB = amountMinB;
    } else {
      const { amountSlippageA, amountSlippageB } = LiquidityMath.getAmountsFromLiquidityWithSlippage(
        poolInfo.sqrtPriceX64,
        SqrtPriceMath.getSqrtPriceX64FromTick(ownerPosition.tickLower),
        SqrtPriceMath.getSqrtPriceX64FromTick(ownerPosition.tickUpper),
        liquidity,
        false,
        true,
        slippage ?? 0,
      );
      _amountMinA = amountSlippageA;
      _amountMinB = amountSlippageB;
    }

    const mintAUseSOLBalance = ownerInfo.useSOLBalance && poolInfo.mintA.mint.equals(WSOLMint);
    const mintBUseSOLBalance = ownerInfo.useSOLBalance && poolInfo.mintB.mint.equals(WSOLMint);

    let ownerTokenAccountA: PublicKey | undefined = undefined;
    let ownerTokenAccountB: PublicKey | undefined = undefined;
    const { account: _ownerTokenAccountA, instructionParams: accountAInstructions } =
      await this.scope.account.getOrCreateTokenAccount({
        mint: poolInfo.mintA.mint,
        notUseTokenAccount: mintAUseSOLBalance,
        owner: this.scope.ownerPubKey,
        createInfo: {
          payer: this.scope.ownerPubKey,
          amount: 0,
        },
        skipCloseAccount: true,
        associatedOnly: mintAUseSOLBalance ? false : associatedOnly,
      });
    ownerTokenAccountA = _ownerTokenAccountA;
    accountAInstructions && txBuilder.addInstruction(accountAInstructions);

    const { account: _ownerTokenAccountB, instructionParams: accountBInstructions } =
      await this.scope.account.getOrCreateTokenAccount({
        mint: poolInfo.mintB.mint,
        notUseTokenAccount: mintBUseSOLBalance,
        owner: this.scope.ownerPubKey,
        createInfo: {
          payer: this.scope.ownerPubKey,
          amount: 0,
        },
        skipCloseAccount: true,
        associatedOnly: mintBUseSOLBalance ? false : associatedOnly,
      });
    ownerTokenAccountB = _ownerTokenAccountB;
    accountBInstructions && txBuilder.addInstruction(accountBInstructions);

    const rewardAccounts: PublicKey[] = [];
    for (const itemReward of poolInfo.rewardInfos) {
      const rewardUseSOLBalance = ownerInfo.useSOLBalance && itemReward.tokenMint.equals(WSOLMint);
      const { account: _ownerRewardAccount, instructionParams: ownerRewardAccountInstructions } =
        await this.scope.account.getOrCreateTokenAccount({
          mint: itemReward.tokenMint,
          notUseTokenAccount: rewardUseSOLBalance,
          owner: this.scope.ownerPubKey,
          createInfo: {
            payer: this.scope.ownerPubKey,
            amount: 0,
          },
          skipCloseAccount: !rewardUseSOLBalance,
          associatedOnly: rewardUseSOLBalance ? false : associatedOnly,
        });
      ownerRewardAccountInstructions && txBuilder.addInstruction(ownerRewardAccountInstructions);
      _ownerRewardAccount && rewardAccounts.push(_ownerRewardAccount);
    }

    if (!ownerTokenAccountA && !ownerTokenAccountB)
      this.logAndCreateError(
        "cannot found target token accounts",
        "tokenAccounts",
        this.scope.account.tokenAccountRawInfos,
      );

    const decreaseInsInfo = await AmmV3Instrument.makeDecreaseLiquidityInstructions({
      poolInfo,
      ownerPosition,
      ownerInfo: {
        wallet: this.scope.ownerPubKey,
        tokenAccountA: ownerTokenAccountA!,
        tokenAccountB: ownerTokenAccountB!,
        rewardAccounts,
      },
      liquidity,
      amountMinA: _amountMinA,
      amountMinB: _amountMinB,
    });

    txBuilder.addInstruction({ instructions: decreaseInsInfo.instructions });

    if (ownerInfo.closePosition) {
      const closeInsInfo = await AmmV3Instrument.makeClosePositionInstructions({
        poolInfo,
        ownerInfo: { wallet: this.scope.ownerPubKey },
        ownerPosition,
      });
      txBuilder.addInstruction({ instructions: closeInsInfo.instructions });
    }

    return txBuilder.build();
  }

  public async closePosition({
    poolId,
    ownerPosition,
    ownerInfo,
  }: {
    poolId: PublicKey;
    ownerPosition: AmmV3PoolPersonalPosition;

    ownerInfo: {
      wallet: PublicKey;
    };
  }): Promise<MakeTransaction> {
    const pool = this._hydratedAmmV3PoolsMap.get(poolId.toBase58());
    if (!pool) this.logAndCreateError("pool not found: ", poolId.toBase58());
    const poolInfo = pool!.state;
    const txBuilder = this.createTxBuilder();
    const ins = await AmmV3Instrument.makeClosePositionInstructions({ poolInfo, ownerInfo, ownerPosition });
    return txBuilder.addInstruction({ instructions: ins.instructions }).build();
  }

  public async swapBaseIn({
    poolId,
    ownerInfo,

    inputMint,
    amountIn,
    amountOutMin,
    priceLimit,

    remainingAccounts,
  }: {
    poolId: PublicKey;
    ownerInfo: {
      feePayer: PublicKey;
      useSOLBalance?: boolean;
    };
    inputMint: PublicKey;
    amountIn: BN;
    amountOutMin: BN;
    priceLimit?: Decimal;
    remainingAccounts: PublicKey[];
  }): Promise<MakeTransaction> {
    this.scope.checkOwner();
    const pool = this._hydratedAmmV3PoolsMap.get(poolId.toBase58());
    if (!pool) this.logAndCreateError("pool not found: ", poolId.toBase58());
    const poolInfo = pool!.state;

    let sqrtPriceLimitX64: BN;
    if (!priceLimit || priceLimit.equals(new Decimal(0))) {
      sqrtPriceLimitX64 = inputMint.equals(poolInfo.mintA.mint)
        ? MIN_SQRT_PRICE_X64.add(ONE)
        : MAX_SQRT_PRICE_X64.sub(ONE);
    } else {
      sqrtPriceLimitX64 = SqrtPriceMath.priceToSqrtPriceX64(
        priceLimit,
        poolInfo.mintA.decimals,
        poolInfo.mintB.decimals,
      );
    }

    const txBuilder = this.createTxBuilder();
    txBuilder.addInstruction({ instructions: [AmmV3Instrument.addComputations()] });
    const isInputMintA = poolInfo.mintA.mint.equals(inputMint);

    let ownerTokenAccountA: PublicKey | undefined = undefined;
    let ownerTokenAccountB: PublicKey | undefined = undefined;

    const { tokenAccount: _ownerTokenAccountA, ...accountAInstructions } = await this.scope.account.processTokenAccount(
      { mint: poolInfo.mintA.mint, amount: isInputMintA ? amountIn : 0, useSOLBalance: ownerInfo.useSOLBalance },
    );
    ownerTokenAccountA = _ownerTokenAccountA;
    txBuilder.addInstruction(accountAInstructions);

    const { tokenAccount: _ownerTokenAccountB, ...accountBInstructions } = await this.scope.account.processTokenAccount(
      { mint: poolInfo.mintB.mint, amount: !isInputMintA ? amountIn : 0, useSOLBalance: ownerInfo.useSOLBalance },
    );
    ownerTokenAccountB = _ownerTokenAccountB;
    txBuilder.addInstruction(accountBInstructions);

    if (!ownerTokenAccountA && !ownerTokenAccountB)
      this.logAndCreateError(
        "cannot found target token accounts",
        "tokenAccounts",
        this.scope.account.tokenAccountRawInfos,
      );

    const insInfo = await AmmV3Instrument.makeSwapBaseInInstructions({
      poolInfo,
      ownerInfo: {
        wallet: this.scope.ownerPubKey,
        tokenAccountA: ownerTokenAccountA!,
        tokenAccountB: ownerTokenAccountB!,
      },

      inputMint,

      amountIn,
      amountOutMin,
      sqrtPriceLimitX64,

      remainingAccounts,
    });
    txBuilder.addInstruction({ instructions: insInfo.instructions });

    return txBuilder.build();
  }

  public getAmountsFromLiquidity({
    poolId,
    ownerPosition,
    liquidity,
    slippage,
    add,
  }: {
    poolId: string | PublicKey;
    ownerPosition: AmmV3PoolPersonalPosition;
    liquidity: BN;
    slippage: number;
    add: boolean;
  }): ReturnTypeGetAmountsFromLiquidity {
    const poolInfo = this._hydratedAmmV3PoolsMap.get(typeof poolId === "string" ? poolId : poolId.toBase58())?.state;
    if (!poolInfo) this.logAndCreateError("pool not found: ", poolId);
    const sqrtPriceX64A = SqrtPriceMath.getSqrtPriceX64FromTick(ownerPosition.tickLower);
    const sqrtPriceX64B = SqrtPriceMath.getSqrtPriceX64FromTick(ownerPosition.tickUpper);
    return LiquidityMath.getAmountsFromLiquidityWithSlippage(
      poolInfo!.sqrtPriceX64,
      sqrtPriceX64A,
      sqrtPriceX64B,
      liquidity,
      add,
      add,
      slippage,
    );
  }

  public async computeAmountOut({
    poolInfo,
    tickArrayCache,
    baseMint,
    amountIn,
    slippage,
    priceLimit = new Decimal(0),
  }: {
    poolInfo: AmmV3PoolInfo;
    tickArrayCache: { [key: string]: TickArray };
    baseMint: PublicKey;

    amountIn: BN;
    slippage: number;
    priceLimit?: Decimal;
  }): Promise<ReturnTypeComputeAmountOut> {
    let sqrtPriceLimitX64: BN;
    if (priceLimit.equals(new Decimal(0))) {
      sqrtPriceLimitX64 = baseMint.equals(poolInfo.mintA.mint)
        ? MIN_SQRT_PRICE_X64.add(ONE)
        : MAX_SQRT_PRICE_X64.sub(ONE);
    } else {
      sqrtPriceLimitX64 = SqrtPriceMath.priceToSqrtPriceX64(
        priceLimit,
        poolInfo.mintA.decimals,
        poolInfo.mintB.decimals,
      );
    }

    const {
      expectedAmountOut,
      remainingAccounts,
      executionPrice: _executionPriceX64,
      feeAmount,
    } = await PoolUtils.getOutputAmountAndRemainAccounts(
      poolInfo,
      tickArrayCache,
      baseMint,
      amountIn,
      sqrtPriceLimitX64,
    );

    const _executionPrice = SqrtPriceMath.sqrtPriceX64ToPrice(
      _executionPriceX64,
      poolInfo.mintA.decimals,
      poolInfo.mintB.decimals,
    );
    const executionPrice = baseMint.equals(poolInfo.mintA.mint) ? _executionPrice : new Decimal(1).div(_executionPrice);

    const minAmountOut = expectedAmountOut
      .mul(new BN(Math.floor((1 - slippage) * 10000000000)))
      .div(new BN(10000000000));

    const poolPrice = poolInfo.mintA.mint.equals(baseMint)
      ? poolInfo.currentPrice
      : new Decimal(1).div(poolInfo.currentPrice);
    const priceImpact = new Percent(
      parseInt(String(Math.abs(parseFloat(executionPrice.toFixed()) - parseFloat(poolPrice.toFixed())) * 1e9)),
      parseInt(String(parseFloat(poolPrice.toFixed()) * 1e9)),
    );

    return {
      amountOut: expectedAmountOut,
      minAmountOut,
      currentPrice: poolInfo.currentPrice,
      executionPrice,
      priceImpact,
      fee: feeAmount,

      remainingAccounts,
    };
  }

  public async computeAmountOutFormat({
    poolInfo,
    tickArrayCache,
    amountIn,
    tokenOut: _tokenOut,
    slippage,
  }: {
    poolInfo: AmmV3PoolInfo;
    tickArrayCache: { [key: string]: TickArray };

    amountIn: TokenAmount;
    tokenOut: Token;
    slippage: Percent;
  }): Promise<ReturnTypeComputeAmountOutFormat> {
    const inputMint = amountIn.token.equals(Token.WSOL) ? WSOLMint : amountIn.token.mint;
    const _slippage = slippage.numerator.toNumber() / slippage.denominator.toNumber();
    const tokenOut = _tokenOut.mint.equals(SOLMint)
      ? new Token({ mint: "sol", decimals: TOKEN_SOL.decimals })
      : _tokenOut;

    const { amountOut, minAmountOut, currentPrice, executionPrice, priceImpact, fee, remainingAccounts } =
      await this.computeAmountOut({
        poolInfo,
        tickArrayCache,
        baseMint: inputMint,
        amountIn: amountIn.raw,
        slippage: _slippage,
      });

    return {
      amountOut: new TokenAmount(tokenOut, amountOut),
      minAmountOut: new TokenAmount(tokenOut, minAmountOut),
      currentPrice: new Price({
        baseToken: amountIn.token,
        denominator: new BN(10).pow(new BN(20 + amountIn.token.decimals)),
        quoteToken: tokenOut,
        numerator: currentPrice.mul(new Decimal(10 ** (20 + tokenOut.decimals))).toFixed(0),
      }),
      executionPrice: new Price({
        baseToken: amountIn.token,
        denominator: new BN(10).pow(new BN(20 + amountIn.token.decimals)),
        quoteToken: tokenOut,
        numerator: executionPrice.mul(new Decimal(10 ** (20 + tokenOut.decimals))).toFixed(0),
      }),
      priceImpact,
      fee: new TokenAmount(amountIn.token, fee),
      remainingAccounts,
    };
  }
}

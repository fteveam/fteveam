import { PublicKey, EpochInfo } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, createTransferInstruction } from "@solana/spl-token";
import {
  WSOLMint,
  AMM_V4,
  CLMM_PROGRAM_ID,
  minExpirationTime,
  getMultipleAccountsInfoWithCustomFlags,
  solToWSol,
  fetchMultipleMintInfos,
} from "@/common";
import { InstructionType, TxVersion } from "@/common/txTool/txType";
import { MakeTxData, MakeMultiTxData } from "@/common/txTool/txTool";
import ModuleBase, { ModuleBaseProps } from "../moduleBase";
import { BigNumberish, parseBigNumberish } from "@/common/bignumber";
import {
  createWSolAccountInstructions,
  closeAccountInstruction,
  makeTransferInstruction,
} from "../account/instruction";
import { TokenAccount } from "../account/types";
import { ComputeBudgetConfig, ReturnTypeFetchMultipleMintInfos } from "@/raydium/type";
import {
  getLiquidityAssociatedAuthority,
  ComputeAmountOutParam,
  liquidityStateV4Layout,
  toAmmComputePoolInfo,
} from "@/raydium/liquidity";
import { PoolInfoLayout } from "@/raydium/clmm/layout";
import { ReturnTypeFetchMultiplePoolTickArrays, PoolUtils, ClmmRpcData, ComputeClmmPoolInfo } from "@/raydium/clmm";
import { struct, publicKey } from "@/marshmallow";
import {
  ReturnTypeGetAllRoute,
  AmmPool as AmmPoolInfo,
  ClmmPool as ClmmPoolInfo,
  PoolType,
  RoutePathType,
  ReturnTypeFetchMultipleInfo,
  ComputeAmountOutLayout,
  ComputeAmountOutAmmLayout,
  ComputePoolType,
  ComputeRoutePathType,
} from "./type";
import { TokenAmount, Price } from "@/module";
import BN from "bn.js";
import { AmmV4Keys, ApiV3Token, ClmmKeys, PoolKeys } from "@/api";
import { toToken, toTokenAmount } from "../token";
import Decimal from "decimal.js";
import { makeSwapInstruction } from "./instrument";
import { AmmRpcData } from "../liquidity";
import { MARKET_STATE_LAYOUT_V3, Market } from "../serum";

const ZERO = new BN(0);
export default class TradeV2 extends ModuleBase {
  constructor(params: ModuleBaseProps) {
    super(params);
  }

  private async getWSolAccounts(): Promise<TokenAccount[]> {
    this.scope.checkOwner();
    await this.scope.account.fetchWalletTokenAccounts();
    const tokenAccounts = this.scope.account.tokenAccounts.filter((acc) => acc.mint.equals(WSOLMint));
    tokenAccounts.sort((a, b) => {
      if (a.isAssociated) return 1;
      if (b.isAssociated) return -1;
      return a.amount.lt(b.amount) ? -1 : 1;
    });
    return tokenAccounts;
  }

  public async unWrapWSol<T extends TxVersion>(props: {
    amount: BigNumberish;
    computeBudgetConfig?: ComputeBudgetConfig;
    tokenProgram?: PublicKey;
    txVersion?: T;
  }): Promise<MakeTxData<T>> {
    const { amount, tokenProgram, txVersion = TxVersion.LEGACY } = props;
    const tokenAccounts = await this.getWSolAccounts();
    const txBuilder = this.createTxBuilder();
    txBuilder.addCustomComputeBudget(props.computeBudgetConfig);
    const ins = await createWSolAccountInstructions({
      connection: this.scope.connection,
      owner: this.scope.ownerPubKey,
      payer: this.scope.ownerPubKey,
      amount: 0,
    });
    txBuilder.addInstruction(ins);

    const amountBN = parseBigNumberish(amount);
    for (let i = 0; i < tokenAccounts.length; i++) {
      if (amountBN.gte(tokenAccounts[i].amount)) {
        txBuilder.addInstruction({
          instructions: [
            closeAccountInstruction({
              tokenAccount: tokenAccounts[i].publicKey!,
              payer: this.scope.ownerPubKey,
              owner: this.scope.ownerPubKey,
              programId: tokenProgram,
            }),
          ],
        });
        amountBN.sub(tokenAccounts[i].amount);
      } else {
        txBuilder.addInstruction({
          instructions: [
            closeAccountInstruction({
              tokenAccount: tokenAccounts[i].publicKey!,
              payer: this.scope.ownerPubKey,
              owner: this.scope.ownerPubKey,
              programId: tokenProgram,
            }),
          ],
        });
        makeTransferInstruction({
          destination: ins.addresses.newAccount,
          source: tokenAccounts[i].publicKey!,
          amount: amountBN,
          owner: this.scope.ownerPubKey,
          tokenProgram,
        });
      }
    }

    return txBuilder.versionBuild({ txVersion }) as Promise<MakeTxData<T>>;
  }

  public async wrapWSol<T extends TxVersion>(
    amount: BigNumberish,
    tokenProgram?: PublicKey,
    txVersion?: T,
  ): Promise<MakeTxData<T>> {
    const tokenAccounts = await this.getWSolAccounts();

    const txBuilder = this.createTxBuilder();
    const ins = await createWSolAccountInstructions({
      connection: this.scope.connection,
      owner: this.scope.ownerPubKey,
      payer: this.scope.ownerPubKey,
      amount,
      skipCloseAccount: true,
    });
    txBuilder.addInstruction(ins);

    if (tokenAccounts.length) {
      // already have wsol account
      txBuilder.addInstruction({
        instructions: [
          makeTransferInstruction({
            // destination: ins.signers![0].publicKey,
            destination: tokenAccounts[0].publicKey!,
            source: ins.addresses.newAccount,
            amount,
            owner: this.scope.ownerPubKey,
            tokenProgram,
          }),
        ],
        endInstructions: [
          closeAccountInstruction({
            tokenAccount: ins.addresses.newAccount,
            payer: this.scope.ownerPubKey,
            owner: this.scope.ownerPubKey,
            programId: tokenProgram,
          }),
        ],
      });
    }
    return txBuilder.versionBuild({ txVersion: txVersion ?? TxVersion.LEGACY }) as Promise<MakeTxData<T>>;
  }

  public async fetchRoutePoolBasicInfo(): Promise<{
    clmmPools: ClmmPoolInfo[];
    ammPools: AmmPoolInfo[];
  }> {
    const ammPoolsData = await this.scope.connection.getProgramAccounts(AMM_V4, {
      dataSlice: { offset: liquidityStateV4Layout.offsetOf("baseMint"), length: 64 },
    });

    const layoutAmm = struct([publicKey("baseMint"), publicKey("quoteMint")]);
    const ammData = ammPoolsData.map((data) => ({
      id: data.pubkey,
      version: 4,
      mintA: layoutAmm.decode(data.account.data).baseMint,
      mintB: layoutAmm.decode(data.account.data).quoteMint,
    }));

    const layoutClmm = struct([publicKey("mintA"), publicKey("mintB")]);
    const clmmPoolsData = await this.scope.connection.getProgramAccounts(CLMM_PROGRAM_ID, {
      filters: [{ dataSize: PoolInfoLayout.span }],
      dataSlice: { offset: PoolInfoLayout.offsetOf("mintA"), length: 64 },
    });

    const clmmData = clmmPoolsData.map((data) => {
      const clmm = layoutClmm.decode(data.account.data);
      return {
        id: data.pubkey,
        version: 6,
        mintA: clmm.mintA,
        mintB: clmm.mintB,
      };
    });

    return {
      clmmPools: clmmData,
      ammPools: ammData,
    };
  }

  public getAllRoute({
    inputMint,
    outputMint,
    clmmPools,
    ammPools,
  }: {
    inputMint: PublicKey;
    outputMint: PublicKey;
    clmmPools: ClmmPoolInfo[];
    ammPools: AmmPoolInfo[];
  }): ReturnTypeGetAllRoute {
    inputMint = inputMint.toString() === PublicKey.default.toString() ? WSOLMint : inputMint;
    outputMint = outputMint.toString() === PublicKey.default.toString() ? WSOLMint : outputMint;

    const needSimulate: { [poolKey: string]: AmmPoolInfo } = {};
    const needTickArray: { [poolKey: string]: ClmmPoolInfo } = {};

    const directPath: PoolType[] = [];

    const routePathDict: RoutePathType = {}; // {[route mint: string]: {in: [] , out: []}}

    for (const itemClmmPool of clmmPools ?? []) {
      if (
        (itemClmmPool.mintA.equals(inputMint) && itemClmmPool.mintB.equals(outputMint)) ||
        (itemClmmPool.mintA.equals(outputMint) && itemClmmPool.mintB.equals(inputMint))
      ) {
        directPath.push(itemClmmPool);
        needTickArray[itemClmmPool.id.toString()] = itemClmmPool;
      }

      if (itemClmmPool.mintA.equals(inputMint)) {
        const t = itemClmmPool.mintB.toString();
        if (routePathDict[t] === undefined)
          routePathDict[t] = {
            mintProgram: TOKEN_PROGRAM_ID, // to fetch later
            in: [],
            out: [],
            mDecimals: 0, // to fetch later
          };
        routePathDict[t].in.push(itemClmmPool);
      }
      if (itemClmmPool.mintB.equals(inputMint)) {
        const t = itemClmmPool.mintA.toString();
        if (routePathDict[t] === undefined)
          routePathDict[t] = {
            mintProgram: TOKEN_PROGRAM_ID, // to fetch later
            in: [],
            out: [],
            mDecimals: 0, // to fetch later
          };
        routePathDict[t].in.push(itemClmmPool);
      }
      if (itemClmmPool.mintA.equals(outputMint)) {
        const t = itemClmmPool.mintB.toString();
        if (routePathDict[t] === undefined)
          routePathDict[t] = {
            mintProgram: TOKEN_PROGRAM_ID, // to fetch later
            in: [],
            out: [],
            mDecimals: 0, // to fetch later
          };
        routePathDict[t].out.push(itemClmmPool);
      }
      if (itemClmmPool.mintB.equals(outputMint)) {
        const t = itemClmmPool.mintA.toString();
        if (routePathDict[t] === undefined)
          routePathDict[t] = {
            mintProgram: TOKEN_PROGRAM_ID, // to fetch later
            in: [],
            out: [],
            mDecimals: 0, // to fetch later
          };
        routePathDict[t].out.push(itemClmmPool);
      }
    }

    const addLiquidityPools: AmmPoolInfo[] = [];

    for (const itemAmmPool of ammPools) {
      if (
        (itemAmmPool.mintA.equals(inputMint) && itemAmmPool.mintB.equals(outputMint)) ||
        (itemAmmPool.mintA.equals(outputMint) && itemAmmPool.mintB.equals(inputMint))
      ) {
        directPath.push(itemAmmPool);
        needSimulate[itemAmmPool.id.toBase58()] = itemAmmPool;
        addLiquidityPools.push(itemAmmPool);
      }
      if (itemAmmPool.mintA.equals(inputMint)) {
        if (routePathDict[itemAmmPool.mintB.toBase58()] === undefined)
          routePathDict[itemAmmPool.mintB.toBase58()] = {
            skipMintCheck: true,
            mintProgram: TOKEN_PROGRAM_ID,
            in: [],
            out: [],
            mDecimals: 0, // to fetch later
          };
        routePathDict[itemAmmPool.mintB.toBase58()].in.push(itemAmmPool);
      }
      if (itemAmmPool.mintB.equals(inputMint)) {
        if (routePathDict[itemAmmPool.mintA.toBase58()] === undefined)
          routePathDict[itemAmmPool.mintA.toBase58()] = {
            skipMintCheck: true,
            mintProgram: TOKEN_PROGRAM_ID,
            in: [],
            out: [],
            mDecimals: 0, // to fetch later
          };
        routePathDict[itemAmmPool.mintA.toBase58()].in.push(itemAmmPool);
      }
      if (itemAmmPool.mintA.equals(outputMint)) {
        if (routePathDict[itemAmmPool.mintB.toBase58()] === undefined)
          routePathDict[itemAmmPool.mintB.toBase58()] = {
            skipMintCheck: true,
            mintProgram: TOKEN_PROGRAM_ID,
            in: [],
            out: [],
            mDecimals: 0, // to fetch later
          };
        routePathDict[itemAmmPool.mintB.toBase58()].out.push(itemAmmPool);
      }
      if (itemAmmPool.mintB.equals(outputMint)) {
        if (routePathDict[itemAmmPool.mintA.toBase58()] === undefined)
          routePathDict[itemAmmPool.mintA.toBase58()] = {
            skipMintCheck: true,
            mintProgram: TOKEN_PROGRAM_ID,
            in: [],
            out: [],
            mDecimals: 0, // to fetch later
          };
        routePathDict[itemAmmPool.mintA.toBase58()].out.push(itemAmmPool);
      }
    }

    for (const t of Object.keys(routePathDict)) {
      if (
        routePathDict[t].in.length === 1 &&
        routePathDict[t].out.length === 1 &&
        routePathDict[t].in[0].id.equals(routePathDict[t].out[0].id)
      ) {
        delete routePathDict[t];
        continue;
      }
      if (routePathDict[t].in.length === 0 || routePathDict[t].out.length === 0) {
        delete routePathDict[t];
        continue;
      }

      const info = routePathDict[t];

      for (const infoIn of info.in) {
        for (const infoOut of info.out) {
          if (infoIn.version === 6 && needTickArray[infoIn.id.toString()] === undefined) {
            needTickArray[infoIn.id.toString()] = infoIn as ClmmPoolInfo;
          } else if (infoIn.version !== 6 && needSimulate[infoIn.id.toString()] === undefined) {
            needSimulate[infoIn.id.toString()] = infoIn as AmmPoolInfo;
          }
          if (infoOut.version === 6 && needTickArray[infoOut.id.toString()] === undefined) {
            needTickArray[infoOut.id.toString()] = infoOut as ClmmPoolInfo;
          } else if (infoOut.version !== 6 && needSimulate[infoOut.id.toString()] === undefined) {
            needSimulate[infoOut.id.toString()] = infoOut as AmmPoolInfo;
          }
        }
      }
    }

    return {
      directPath,
      addLiquidityPools,
      routePathDict,
      needSimulate: Object.values(needSimulate),
      needTickArray: Object.values(needTickArray),
    };
  }

  private computeAmountOut({
    itemPool,
    tickCache,
    simulateCache,
    chainTime,
    epochInfo,
    slippage,
    outputToken,
    amountIn,
  }: {
    itemPool: ComputePoolType;
    tickCache: ReturnTypeFetchMultiplePoolTickArrays;
    simulateCache: ReturnTypeFetchMultipleInfo;
    chainTime: number;
    epochInfo: EpochInfo;
    amountIn: TokenAmount;
    outputToken: ApiV3Token;
    slippage: number;
  }): ComputeAmountOutAmmLayout {
    if (itemPool.version === 6) {
      const {
        allTrade,
        realAmountIn,
        amountOut,
        minAmountOut,
        expirationTime,
        currentPrice,
        executionPrice,
        priceImpact,
        fee,
        remainingAccounts,
        executionPriceX64,
      } = PoolUtils.computeAmountOutFormat({
        poolInfo: itemPool,
        tickArrayCache: tickCache[itemPool.id.toString()],
        amountIn: amountIn.raw,
        tokenOut: outputToken,
        slippage,
        epochInfo,
        catchLiquidityInsufficient: true,
      });
      return {
        allTrade,
        amountIn: realAmountIn,
        amountOut,
        minAmountOut,
        currentPrice: new Decimal(currentPrice.toFixed()),
        executionPrice: new Decimal(executionPrice.toFixed()),
        priceImpact: new Decimal(priceImpact.toFixed()),
        fee: [fee],
        remainingAccounts: [remainingAccounts],
        routeType: "amm",
        poolInfoList: [itemPool],
        poolReady: itemPool.startTime < chainTime,
        poolType: "CLMM",
        slippage,
        clmmExPriceX64: [executionPriceX64],
        expirationTime: minExpirationTime(realAmountIn.expirationTime, expirationTime),
      };
    } else {
      if (![1, 6, 7].includes(simulateCache[itemPool.id.toString()].status)) throw Error("swap error");
      const { amountOut, minAmountOut, currentPrice, executionPrice, priceImpact, fee } =
        this.scope.liquidity.computeAmountOut({
          poolInfo: simulateCache[itemPool.id.toString()],
          amountIn: amountIn.raw,
          mintIn: amountIn.token.mint,
          mintOut: outputToken.address,
          slippage,
        });
      return {
        amountIn: { amount: amountIn, fee: undefined, expirationTime: undefined },
        amountOut: {
          amount: toTokenAmount({
            ...outputToken,
            amount: amountOut,
          }),
          fee: undefined,
          expirationTime: undefined,
        },
        minAmountOut: {
          amount: toTokenAmount({
            ...outputToken,
            amount: minAmountOut,
          }),
          fee: undefined,
          expirationTime: undefined,
        },
        currentPrice,
        executionPrice,
        priceImpact,
        fee: [new TokenAmount(amountIn.token, fee)],
        routeType: "amm",
        poolInfoList: [itemPool],
        remainingAccounts: [],
        poolReady: Number(simulateCache[itemPool.id as string].openTime) < chainTime,
        poolType: itemPool.version === 5 ? "STABLE" : undefined,
        expirationTime: undefined,
        allTrade: true,
        slippage,
        clmmExPriceX64: [undefined],
      };
    }
  }

  public getAllRouteComputeAmountOut({
    inputTokenAmount,
    outputToken: propOutputToken,
    directPath,
    routePathDict,
    simulateCache,
    tickCache,
    slippage,
    chainTime,
    epochInfo,
    feeConfig,
  }: {
    directPath: ComputePoolType[];
    routePathDict: ComputeRoutePathType;
    simulateCache: ReturnTypeFetchMultipleInfo;
    tickCache: ReturnTypeFetchMultiplePoolTickArrays;

    mintInfos: ReturnTypeFetchMultipleMintInfos;

    inputTokenAmount: TokenAmount;
    outputToken: ApiV3Token;
    slippage: number;
    chainTime: number;
    epochInfo: EpochInfo;

    feeConfig?: {
      feeBps: BN;
      feeAccount: PublicKey;
    };
  }): ComputeAmountOutLayout[] {
    const _amountInFee =
      feeConfig === undefined
        ? new BN(0)
        : inputTokenAmount.raw.mul(new BN(feeConfig.feeBps.toNumber())).div(new BN(10000));
    const _amoutIn = inputTokenAmount.raw.sub(_amountInFee);
    const amountIn = new TokenAmount(inputTokenAmount.token, _amoutIn);
    const _inFeeConfig =
      feeConfig === undefined
        ? undefined
        : {
            feeAmount: _amountInFee,
            feeAccount: feeConfig.feeAccount,
          };
    const outputToken = {
      ...propOutputToken,
      address: solToWSol(propOutputToken.address).toString(),
    };
    const outRoute: ComputeAmountOutLayout[] = [];
    for (const itemPool of directPath) {
      try {
        outRoute.push({
          ...this.computeAmountOut({
            itemPool,
            tickCache,
            simulateCache,
            chainTime,
            epochInfo,
            slippage,
            outputToken,
            amountIn,
          }),
          feeConfig: _inFeeConfig,
        });
      } catch (e: any) {
        this.logDebug("direct error", itemPool.version, itemPool.id.toString(), e.message);
        /* empty */
      }
    }
    this.logDebug("direct done");
    for (const [routeMint, info] of Object.entries(routePathDict)) {
      // const routeToken = new Token(info.mintProgram, routeMint, info.mDecimals);
      const routeToken = {
        chainId: 101,
        address: routeMint,
        programId: info.mintProgram.toBase58(),
        logoURI: "",
        symbol: "",
        name: "",
        decimals: info.mDecimals,
        tags: [],
        extensions: {},
      };
      const maxFirstIn = info.in
        .map((i) => {
          try {
            return {
              pool: i,
              data: this.computeAmountOut({
                itemPool: i,
                tickCache,
                simulateCache,
                chainTime,
                epochInfo,
                slippage,
                outputToken: routeToken,
                amountIn,
              }),
            };
          } catch (e: any) {
            this.logDebug("route in error", i.version, i.id.toString(), e.message);
            return undefined;
          }
        })
        .sort((_a, _b) => {
          const a = _a === undefined ? ZERO : _a.data.amountOut.amount.raw.sub(_a.data.amountOut.fee?.raw ?? ZERO);
          const b = _b === undefined ? ZERO : _b.data.amountOut.amount.raw.sub(_b.data.amountOut.fee?.raw ?? ZERO);
          return a.lt(b) ? 1 : -1;
        })[0];
      if (maxFirstIn === undefined) continue;
      const routeAmountIn = new TokenAmount(
        toToken(routeToken),
        maxFirstIn.data.amountOut.amount.raw.sub(maxFirstIn.data.amountOut.fee?.raw ?? ZERO),
      );
      for (const iOutPool of info.out) {
        try {
          const outC = this.computeAmountOut({
            itemPool: iOutPool,
            tickCache,
            simulateCache,
            chainTime,
            epochInfo,
            slippage,
            outputToken,
            amountIn: routeAmountIn,
          });
          outRoute.push({
            ...outC,
            allTrade: maxFirstIn.data.allTrade && outC.allTrade ? true : false,
            amountIn: maxFirstIn.data.amountIn,
            amountOut: outC.amountOut,
            minAmountOut: outC.minAmountOut,
            currentPrice: undefined,
            executionPrice: new Decimal(
              new Price({
                baseToken: maxFirstIn.data.amountIn.amount.token,
                denominator: maxFirstIn.data.amountIn.amount.raw,
                quoteToken: outC.amountOut.amount.token,
                numerator: outC.amountOut.amount.raw.sub(outC.amountOut.fee?.raw ?? ZERO),
              }).toFixed(),
            ),
            priceImpact: new Decimal(maxFirstIn.data.priceImpact.add(outC.priceImpact).toFixed()),
            fee: [maxFirstIn.data.fee[0], outC.fee[0]],
            routeType: "route",
            poolInfoList: [maxFirstIn.pool, iOutPool],
            remainingAccounts: [maxFirstIn.data.remainingAccounts[0], outC.remainingAccounts[0]],
            minMiddleAmountFee: outC.amountOut.fee?.raw
              ? new TokenAmount(
                  (maxFirstIn.data.amountOut.amount as TokenAmount).token,
                  (maxFirstIn.data.amountOut.fee?.raw ?? ZERO).add(outC.amountOut.fee?.raw ?? ZERO),
                )
              : undefined,
            middleToken: (maxFirstIn.data.amountOut.amount as TokenAmount).token,
            poolReady: maxFirstIn.data.poolReady && outC.poolReady,
            poolType: [maxFirstIn.data.poolType, outC.poolType],
            feeConfig: _inFeeConfig,
            expirationTime: minExpirationTime(maxFirstIn.data.expirationTime, outC.expirationTime),
          });
        } catch (e: any) {
          this.logDebug("route out error", iOutPool.version, iOutPool.id.toString(), e.message);
          /* empty */
        }
      }
    }

    return outRoute
      .filter((i) => i.allTrade)
      .sort((a, b) => (a.amountOut.amount.raw.sub(b.amountOut.amount.raw).gt(ZERO) ? -1 : 1));
  }

  public async swap<T extends TxVersion>({
    swapInfo,
    swapPoolKeys,
    ownerInfo,
    computeBudgetConfig,
    routeProgram,
    txVersion,
  }: {
    txVersion: T;
    swapInfo: ComputeAmountOutLayout;
    swapPoolKeys?: PoolKeys[];
    ownerInfo: {
      associatedOnly: boolean;
      checkCreateATAOwner: boolean;
    };
    routeProgram: PublicKey;
    computeBudgetConfig?: ComputeBudgetConfig;
  }): Promise<MakeMultiTxData<T>> {
    const txBuilder = this.createTxBuilder();

    const amountIn = swapInfo.amountIn;
    const amountOut = swapInfo.amountOut;
    const useSolBalance = amountIn.amount.token.mint.equals(WSOLMint);
    const outSolBalance = amountOut.amount.token.mint.equals(WSOLMint);
    const inputMint = amountIn.amount.token.mint;
    const inputProgramId = amountIn.amount.token.isToken2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
    const outputMint = amountOut.amount.token.mint;
    const outputProgramId = amountOut.amount.token.isToken2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;

    const { account: sourceAcc, instructionParams: sourceAccInsParams } =
      await this.scope.account.getOrCreateTokenAccount({
        tokenProgram: inputProgramId,
        mint: inputMint,
        notUseTokenAccount: useSolBalance,
        owner: this.scope.ownerPubKey,
        skipCloseAccount: !useSolBalance,
        createInfo: useSolBalance
          ? {
              payer: this.scope.ownerPubKey,
              amount: amountIn.amount.raw,
            }
          : undefined,
        associatedOnly: useSolBalance ? false : ownerInfo.associatedOnly,
        checkCreateATAOwner: ownerInfo.checkCreateATAOwner,
      });

    sourceAccInsParams && txBuilder.addInstruction(sourceAccInsParams);

    if (sourceAcc === undefined) {
      throw Error("input account check error");
    }

    const { account: destinationAcc, instructionParams: destinationAccInsParams } =
      await this.scope.account.getOrCreateTokenAccount({
        tokenProgram: outputProgramId,
        mint: outputMint,
        notUseTokenAccount: outSolBalance,
        owner: this.scope.ownerPubKey,
        skipCloseAccount: !outSolBalance,
        createInfo: {
          payer: this.scope.ownerPubKey,
          amount: 0,
        },
        associatedOnly: outSolBalance ? false : ownerInfo.associatedOnly,
        checkCreateATAOwner: ownerInfo.checkCreateATAOwner,
      });

    destinationAccInsParams && txBuilder.addInstruction(destinationAccInsParams);

    let routeTokenAcc: PublicKey | undefined = undefined;
    if (swapInfo.routeType === "route") {
      const middleMint = swapInfo.middleToken;

      const { account, instructionParams } = await this.scope.account.getOrCreateTokenAccount({
        tokenProgram: middleMint.isToken2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
        mint: middleMint.mint,
        owner: this.scope.ownerPubKey,
        skipCloseAccount: false,
        createInfo: {
          payer: this.scope.ownerPubKey,
          amount: 0,
        },
        associatedOnly: false,
        checkCreateATAOwner: ownerInfo.checkCreateATAOwner,
      });
      routeTokenAcc = account;
      instructionParams && txBuilder.addInstruction(instructionParams);
    }

    const poolKeys = swapPoolKeys ? swapPoolKeys : await this.computePoolToPoolKeys({ pools: swapInfo.poolInfoList });
    const swapIns = makeSwapInstruction({
      routeProgram,
      inputMint,
      swapInfo: {
        ...swapInfo,
        poolInfo: [...swapInfo.poolInfoList],
        poolKey: poolKeys,
      },
      ownerInfo: {
        wallet: this.scope.ownerPubKey,
        sourceToken: sourceAcc,
        routeToken: routeTokenAcc,
        destinationToken: destinationAcc!,
      },
    });
    if (swapInfo.feeConfig !== undefined) {
      txBuilder.addInstruction({
        instructions: [
          createTransferInstruction(
            sourceAcc,
            swapInfo.feeConfig.feeAccount,
            this.scope.ownerPubKey,
            swapInfo.feeConfig.feeAmount.toNumber(),
          ),
        ],
        instructionTypes: [InstructionType.TransferAmount],
      });
    }
    txBuilder.addInstruction(swapIns);

    if (txVersion === TxVersion.V0)
      return txBuilder.sizeCheckBuildV0({ computeBudgetConfig, address: swapIns.address }) as Promise<
        MakeMultiTxData<T>
      >;
    return txBuilder.sizeCheckBuild({ computeBudgetConfig, address: swapIns.address }) as Promise<MakeMultiTxData<T>>;
  }

  /** trade related utils */

  public async fetchSwapRoutesData({
    routes,
    inputMint,
    outputMint,
  }: {
    inputMint: string | PublicKey;
    outputMint: string | PublicKey;
    routes: ReturnTypeGetAllRoute;
  }): Promise<{
    mintInfos: ReturnTypeFetchMultipleMintInfos;
    ammPoolsRpcInfo: Record<string, AmmRpcData>;
    ammSimulateCache: Record<string, ComputeAmountOutParam["poolInfo"]>;
    clmmPoolsRpcInfo: Record<string, ClmmRpcData>;
    computeClmmPoolInfo: Record<string, ComputeClmmPoolInfo>;
    computePoolTickData: ReturnTypeFetchMultiplePoolTickArrays;
    routePathDict: ComputeRoutePathType;
  }> {
    const mintSet = new Set([
      ...routes.needTickArray.map((p) => [p.mintA.toBase58(), p.mintB.toBase58()]).flat(),
      inputMint.toString(),
      outputMint.toString(),
    ]);

    console.log("fetching amm pools info, total: ", routes.needSimulate.length);
    const ammPoolsRpcInfo = await this.scope.liquidity.getRpcPoolInfos(routes.needSimulate.map((p) => p.id));
    const ammSimulateCache = toAmmComputePoolInfo(ammPoolsRpcInfo);

    // amm doesn't support token2022 yet, so don't need to fetch mint info
    Object.values(ammSimulateCache).forEach((p) => {
      mintSet.delete(p.mintA.address);
      mintSet.delete(p.mintB.address);
    });

    console.log("fetching mints info, total: ", mintSet.size);
    const mintInfos = await fetchMultipleMintInfos({
      connection: this.scope.connection,
      mints: Array.from(mintSet).map((m) => new PublicKey(m)),
    });

    // set amm mint data to mintInfo
    Object.values(ammSimulateCache).forEach((p) => {
      mintInfos[p.mintA.address] = {
        address: new PublicKey(p.mintA.address),
        programId: TOKEN_PROGRAM_ID,
        mintAuthority: null,
        supply: BigInt(0),
        decimals: p.mintA.decimals,
        isInitialized: true,
        freezeAuthority: null,
        tlvData: Buffer.from("0", "hex"),
        feeConfig: undefined,
      };
      mintInfos[p.mintB.address] = {
        address: new PublicKey(p.mintB.address),
        programId: TOKEN_PROGRAM_ID,
        mintAuthority: null,
        supply: BigInt(0),
        decimals: p.mintB.decimals,
        isInitialized: true,
        freezeAuthority: null,
        tlvData: Buffer.from("0", "hex"),
        feeConfig: undefined,
      };
    });

    console.log("fetching clmm pools info, total:", routes.needTickArray.length);
    const clmmPoolsRpcInfo = await this.scope.clmm.getRpcClmmPoolInfos({
      poolIds: routes.needTickArray.map((p) => p.id),
    });
    const { computeClmmPoolInfo, computePoolTickData } = await this.scope.clmm.getComputeClmmPoolInfos({
      clmmPoolsRpcInfo,
      mintInfos,
    });

    // update route pool mint info
    const routePathDict = Object.keys(routes.routePathDict).reduce(
      (acc, cur) => ({
        ...acc,
        [cur]: {
          ...routes.routePathDict[cur],
          mintProgram: mintInfos[cur].programId,
          mDecimals: mintInfos[cur].decimals,
          in: routes.routePathDict[cur].in.map(
            (p) => ammSimulateCache[p.id.toBase58()] || computeClmmPoolInfo[p.id.toBase58()],
          ),
          out: routes.routePathDict[cur].out.map(
            (p) => ammSimulateCache[p.id.toBase58()] || computeClmmPoolInfo[p.id.toBase58()],
          ),
        },
      }),
      {} as ComputeRoutePathType,
    );

    return {
      mintInfos,

      ammPoolsRpcInfo,
      ammSimulateCache,

      clmmPoolsRpcInfo,
      computeClmmPoolInfo,
      computePoolTickData,

      routePathDict,
    };
  }

  public async computePoolToPoolKeys({
    pools,
    clmmRpcData = {},
    ammRpcData = {},
  }: {
    pools: ComputePoolType[];
    clmmRpcData?: Record<string, ClmmRpcData>;
    ammRpcData?: Record<string, AmmRpcData>;
  }): Promise<PoolKeys[]> {
    const clmmFetchKeys = new Set(
      pools.filter((p) => p.version === 6 && !clmmRpcData[p.id.toString()]).map((p) => p.id.toString()),
    );
    if (clmmFetchKeys.size > 0) {
      const clmmData = this.scope.clmm.getRpcClmmPoolInfos({ poolIds: Array.from(clmmFetchKeys) });
      Object.keys(clmmData).forEach((poolId) => {
        clmmRpcData[poolId] = clmmData[poolId];
      });
    }

    const ammFetchKeys = new Set(
      pools.filter((p) => p.version === 4 && !ammRpcData[p.id.toString()]).map((p) => p.id.toString()),
    );
    if (ammFetchKeys.size > 0) {
      const ammData = this.scope.liquidity.getRpcPoolInfos(Array.from(clmmFetchKeys));
      Object.keys(ammData).forEach((poolId) => {
        ammRpcData[poolId] = ammData[poolId];
      });
    }

    const ammMarketFetchKeys = new Set(
      pools.filter((p) => p.version === 4).map((p) => (p as ComputeAmountOutParam["poolInfo"]).marketId),
    );
    const marketData: Record<
      string,
      {
        marketProgramId: string;
        marketId: string;
        marketAuthority: string;
        marketBaseVault: string;
        marketQuoteVault: string;
        marketBids: string;
        marketAsks: string;
        marketEventQueue: string;
      }
    > = {};
    if (ammMarketFetchKeys.size > 0) {
      const marketAccount = await getMultipleAccountsInfoWithCustomFlags(
        this.scope.connection,
        Array.from(ammMarketFetchKeys).map((p) => ({ pubkey: new PublicKey(p) })),
      );
      marketAccount.forEach((m) => {
        if (!m.accountInfo) return;
        const itemMarketInfo = MARKET_STATE_LAYOUT_V3.decode(m.accountInfo.data);
        marketData[m.pubkey.toBase58()] = {
          marketId: m.pubkey.toString(),
          marketProgramId: m.accountInfo.owner.toString(),
          marketAuthority: Market.getAssociatedAuthority({
            programId: m.accountInfo.owner,
            marketId: m.pubkey,
          }).publicKey.toString(),
          marketBaseVault: itemMarketInfo.baseVault.toString(),
          marketQuoteVault: itemMarketInfo.quoteVault.toString(),
          marketBids: itemMarketInfo.bids.toString(),
          marketAsks: itemMarketInfo.asks.toString(),
          marketEventQueue: itemMarketInfo.eventQueue.toString(),
        };
      });
    }

    const poolKeys: PoolKeys[] = [];
    pools.forEach((pool) => {
      if (pool.version === 6) {
        const rpcInfo = clmmRpcData[pool.id.toString()];
        const clmmKeys: ClmmKeys = {
          programId: pool.programId.toBase58(),
          id: pool.id.toBase58(),
          mintA: pool.mintA,
          mintB: pool.mintB,
          openTime: String(pool.startTime),
          vault: {
            A: rpcInfo.vaultA.toBase58(),
            B: rpcInfo.vaultB.toBase58(),
          },
          config: {
            ...pool.ammConfig,
            id: pool.ammConfig.id.toString(),
            defaultRange: 0,
            defaultRangePoint: [],
          },
          rewardInfos: [],
        };
        poolKeys.push(clmmKeys);
      } else {
        const rpcInfo = ammRpcData[pool.id.toString()];
        const ammKeys: AmmV4Keys = {
          programId: pool.programId,
          id: pool.id,
          mintA: pool.mintA,
          mintB: pool.mintB,
          openTime: String(pool.openTime),
          vault: {
            A: rpcInfo.baseVault.toBase58(),
            B: rpcInfo.quoteVault.toBase58(),
          },
          authority: getLiquidityAssociatedAuthority({ programId: new PublicKey(pool.programId) }).publicKey.toString(),
          openOrders: rpcInfo.openOrders.toBase58(),
          targetOrders: rpcInfo.targetOrders.toBase58(),
          mintLp: pool.lpMint,
          ...marketData[pool.marketId],
        };
        poolKeys.push(ammKeys);
      }
    });
    return poolKeys;
  }
}

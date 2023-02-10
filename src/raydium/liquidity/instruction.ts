import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";

import { parseBigNumberish } from "../../common/bignumber";
import { createLogger } from "../../common/logger";
import { accountMeta, commonSystemAccountMeta, RENT_PROGRAM_ID } from "../../common/pubKey";
import { struct, u8, u64 } from "../../marshmallow";

import {
  addLiquidityLayout,
  createPoolV4Layout,
  fixedSwapInLayout,
  fixedSwapOutLayout,
  initPoolLayout,
  removeLiquidityLayout,
} from "./layout";
import { MODEL_DATA_PUBKEY } from "./stable";
import {
  LiquidityAddInstructionParams,
  LiquidityAssociatedPoolKeys,
  LiquidityInitPoolInstructionParams,
  LiquidityPoolKeys,
  LiquidityRemoveInstructionParams,
  LiquiditySwapFixedInInstructionParamsV4,
  LiquiditySwapFixedOutInstructionParamsV4,
  LiquiditySwapInstructionParams,
} from "./type";
import BN from "bn.js";

const logger = createLogger("Raydium_liquidity_instruction");

export function makeAMMSwapInstruction(params: LiquiditySwapInstructionParams): TransactionInstruction {
  const { poolKeys, userKeys, amountIn, amountOut, fixedSide } = params;
  const { version } = poolKeys;
  if (version === 4 || version === 5) {
    const props = { poolKeys, userKeys };
    if (fixedSide === "in") {
      return makeSwapFixedInInstruction(
        {
          ...props,
          amountIn,
          minAmountOut: amountOut,
        },
        version,
      );
    } else if (fixedSide === "out") {
      return makeSwapFixedOutInstruction(
        {
          ...props,
          maxAmountIn: amountIn,
          amountOut,
        },
        version,
      );
    }
    logger.logWithError("invalid params", "params", params);
  }

  logger.logWithError("invalid version", "poolKeys.version", version);
  throw new Error("invalid version");
}

export function makeSimulatePoolInfoInstruction(poolKeys: LiquidityPoolKeys): TransactionInstruction {
  const simulatePoolLayout = struct([u8("instruction"), u8("simulateType")]);
  const data = Buffer.alloc(simulatePoolLayout.span);
  simulatePoolLayout.encode(
    {
      instruction: 12,
      simulateType: 0,
    },
    data,
  );

  const keys = [
    // amm
    accountMeta({ pubkey: poolKeys.id, isWritable: false }),
    accountMeta({ pubkey: poolKeys.authority, isWritable: false }),
    accountMeta({ pubkey: poolKeys.openOrders, isWritable: false }),
    accountMeta({ pubkey: poolKeys.baseVault, isWritable: false }),
    accountMeta({ pubkey: poolKeys.quoteVault, isWritable: false }),
    accountMeta({ pubkey: poolKeys.lpMint, isWritable: false }),
    // serum
    accountMeta({ pubkey: poolKeys.marketId, isWritable: false }),
    accountMeta({ pubkey: poolKeys.marketEventQueue, isWritable: false }),
  ];

  return new TransactionInstruction({
    programId: poolKeys.programId,
    keys,
    data,
  });
}

export function makeSwapFixedInInstruction(
  { poolKeys, userKeys, amountIn, minAmountOut }: LiquiditySwapFixedInInstructionParamsV4,
  version: number,
): TransactionInstruction {
  const data = Buffer.alloc(fixedSwapInLayout.span);
  fixedSwapInLayout.encode(
    {
      instruction: 9,
      amountIn: parseBigNumberish(amountIn),
      minAmountOut: parseBigNumberish(minAmountOut),
    },
    data,
  );
  const keys = [
    // amm
    accountMeta({ pubkey: TOKEN_PROGRAM_ID, isWritable: false }),
    accountMeta({ pubkey: poolKeys.id }),
    accountMeta({ pubkey: poolKeys.authority, isWritable: false }),
    accountMeta({ pubkey: poolKeys.openOrders }),
  ];

  if (version === 4) keys.push(accountMeta({ pubkey: poolKeys.targetOrders }));
  keys.push(accountMeta({ pubkey: poolKeys.baseVault }), accountMeta({ pubkey: poolKeys.quoteVault }));
  if (version === 5) keys.push(accountMeta({ pubkey: MODEL_DATA_PUBKEY }));
  keys.push(
    // serum
    accountMeta({ pubkey: poolKeys.marketProgramId, isWritable: false }),
    accountMeta({ pubkey: poolKeys.marketId }),
    accountMeta({ pubkey: poolKeys.marketBids }),
    accountMeta({ pubkey: poolKeys.marketAsks }),
    accountMeta({ pubkey: poolKeys.marketEventQueue }),
    accountMeta({ pubkey: poolKeys.marketBaseVault }),
    accountMeta({ pubkey: poolKeys.marketQuoteVault }),
    accountMeta({ pubkey: poolKeys.marketAuthority, isWritable: false }),
    // user
    accountMeta({ pubkey: userKeys.tokenAccountIn }),
    accountMeta({ pubkey: userKeys.tokenAccountOut }),
    accountMeta({ pubkey: userKeys.owner, isWritable: false }),
  );

  return new TransactionInstruction({
    programId: poolKeys.programId,
    keys,
    data,
  });
}

export function makeSwapFixedOutInstruction(
  { poolKeys, userKeys, maxAmountIn, amountOut }: LiquiditySwapFixedOutInstructionParamsV4,
  version: number,
): TransactionInstruction {
  const data = Buffer.alloc(fixedSwapOutLayout.span);
  fixedSwapOutLayout.encode(
    {
      instruction: 11,
      maxAmountIn: parseBigNumberish(maxAmountIn),
      amountOut: parseBigNumberish(amountOut),
    },
    data,
  );

  const keys = [
    accountMeta({ pubkey: SystemProgram.programId, isWritable: false }),
    // amm
    accountMeta({ pubkey: poolKeys.id }),
    accountMeta({ pubkey: poolKeys.authority, isWritable: false }),
    accountMeta({ pubkey: poolKeys.openOrders }),
    accountMeta({ pubkey: poolKeys.targetOrders }),
    accountMeta({ pubkey: poolKeys.baseVault }),
    accountMeta({ pubkey: poolKeys.quoteVault }),
  ];

  if (version === 5) keys.push(accountMeta({ pubkey: MODEL_DATA_PUBKEY }));

  keys.push(
    // serum
    accountMeta({ pubkey: poolKeys.marketProgramId, isWritable: false }),
    accountMeta({ pubkey: poolKeys.marketId }),
    accountMeta({ pubkey: poolKeys.marketBids }),
    accountMeta({ pubkey: poolKeys.marketAsks }),
    accountMeta({ pubkey: poolKeys.marketEventQueue }),
    accountMeta({ pubkey: poolKeys.marketBaseVault }),
    accountMeta({ pubkey: poolKeys.marketQuoteVault }),
    accountMeta({ pubkey: poolKeys.marketAuthority, isWritable: false }),
    accountMeta({ pubkey: userKeys.tokenAccountIn }),
    accountMeta({ pubkey: userKeys.tokenAccountOut }),
    accountMeta({ pubkey: userKeys.owner, isWritable: false, isSigner: true }),
  );

  return new TransactionInstruction({
    programId: poolKeys.programId,
    keys,
    data,
  });
}

export function makeCreatePoolInstruction(
  params: LiquidityAssociatedPoolKeys & { owner: PublicKey },
): TransactionInstruction {
  const { owner, ...poolKeys } = params;
  const data = Buffer.alloc(createPoolV4Layout.span);
  createPoolV4Layout.encode(
    {
      instruction: 10,
      nonce: poolKeys.nonce,
    },
    data,
  );

  const keys = [
    ...commonSystemAccountMeta,
    // amm
    accountMeta({ pubkey: poolKeys.targetOrders }),
    accountMeta({ pubkey: poolKeys.withdrawQueue }),
    accountMeta({ pubkey: poolKeys.authority, isWritable: false }),
    accountMeta({ pubkey: poolKeys.lpMint }),
    accountMeta({ pubkey: poolKeys.baseMint, isWritable: false }),
    accountMeta({ pubkey: poolKeys.quoteMint, isWritable: false }),
    accountMeta({ pubkey: poolKeys.baseVault }),
    accountMeta({ pubkey: poolKeys.quoteVault }),
    accountMeta({ pubkey: poolKeys.lpVault }),
    // serum
    accountMeta({ pubkey: poolKeys.marketId, isWritable: false }),
    accountMeta({ pubkey: owner, isSigner: true }),
  ];
  return new TransactionInstruction({
    programId: poolKeys.programId,
    keys,
    data,
  });
}

export function makeCreatePoolV4InstructionV2({
  programId,
  ammId,
  ammAuthority,
  ammOpenOrders,
  lpMint,
  coinMint,
  pcMint,
  coinVault,
  pcVault,
  withdrawQueue,
  ammTargetOrders,
  poolTempLp,
  marketProgramId,
  marketId,
  userWallet,
  userCoinVault,
  userPcVault,
  userLpVault,
  nonce,
  openTime,
  coinAmount,
  pcAmount,
}: {
  programId: PublicKey;
  ammId: PublicKey;
  ammAuthority: PublicKey;
  ammOpenOrders: PublicKey;
  lpMint: PublicKey;
  coinMint: PublicKey;
  pcMint: PublicKey;
  coinVault: PublicKey;
  pcVault: PublicKey;
  withdrawQueue: PublicKey;
  ammTargetOrders: PublicKey;
  poolTempLp: PublicKey;
  marketProgramId: PublicKey;
  marketId: PublicKey;
  userWallet: PublicKey;
  userCoinVault: PublicKey;
  userPcVault: PublicKey;
  userLpVault: PublicKey;

  nonce: number;
  openTime: BN;
  coinAmount: BN;
  pcAmount: BN;
}): TransactionInstruction {
  const dataLayout = struct([u8("instruction"), u8("nonce"), u64("openTime"), u64("pcAmount"), u64("coinAmount")]);

  const keys = [
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: RENT_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ammId, isSigner: false, isWritable: true },
    { pubkey: ammAuthority, isSigner: false, isWritable: false },
    { pubkey: ammOpenOrders, isSigner: false, isWritable: true },
    { pubkey: lpMint, isSigner: false, isWritable: true },
    { pubkey: coinMint, isSigner: false, isWritable: false },
    { pubkey: pcMint, isSigner: false, isWritable: false },
    { pubkey: coinVault, isSigner: false, isWritable: true },
    { pubkey: pcVault, isSigner: false, isWritable: true },
    { pubkey: withdrawQueue, isSigner: false, isWritable: true },
    { pubkey: ammTargetOrders, isSigner: false, isWritable: true },
    { pubkey: poolTempLp, isSigner: false, isWritable: true },
    { pubkey: marketProgramId, isSigner: false, isWritable: false },
    { pubkey: marketId, isSigner: false, isWritable: false },
    { pubkey: userWallet, isSigner: true, isWritable: true },
    { pubkey: userCoinVault, isSigner: false, isWritable: true },
    { pubkey: userPcVault, isSigner: false, isWritable: true },
    { pubkey: userLpVault, isSigner: false, isWritable: true },
  ];

  const data = Buffer.alloc(dataLayout.span);
  dataLayout.encode({ instruction: 1, nonce, openTime, coinAmount, pcAmount }, data);

  return new TransactionInstruction({
    keys,
    programId,
    data,
  });
}

export function makeInitPoolInstruction(params: LiquidityInitPoolInstructionParams): TransactionInstruction {
  const { poolKeys, userKeys, startTime } = params;
  const data = Buffer.alloc(initPoolLayout.span);
  initPoolLayout.encode(
    {
      instruction: 0,
      nonce: poolKeys.nonce,
      startTime: parseBigNumberish(startTime),
    },
    data,
  );

  const keys = [
    ...commonSystemAccountMeta,
    // amm
    accountMeta({ pubkey: poolKeys.id }),
    accountMeta({ pubkey: poolKeys.authority, isWritable: false }),
    accountMeta({ pubkey: poolKeys.openOrders }),
    accountMeta({ pubkey: poolKeys.lpMint }),
    accountMeta({ pubkey: poolKeys.baseMint, isWritable: false }),
    accountMeta({ pubkey: poolKeys.quoteMint, isWritable: false }),
    accountMeta({ pubkey: poolKeys.baseVault, isWritable: false }),
    accountMeta({ pubkey: poolKeys.quoteVault, isWritable: false }),
    accountMeta({ pubkey: poolKeys.withdrawQueue }),
    accountMeta({ pubkey: poolKeys.targetOrders }),
    accountMeta({ pubkey: userKeys.lpTokenAccount }),
    accountMeta({ pubkey: poolKeys.lpVault, isWritable: false }),
    // serum
    accountMeta({ pubkey: poolKeys.marketProgramId, isWritable: false }),
    accountMeta({ pubkey: poolKeys.marketId, isWritable: false }),
    // user
    accountMeta({ pubkey: userKeys.payer, isSigner: true }),
  ];

  return new TransactionInstruction({
    programId: poolKeys.programId,
    keys,
    data,
  });
}

export function makeAddLiquidityInstruction(params: LiquidityAddInstructionParams): TransactionInstruction {
  const { poolKeys, userKeys, baseAmountIn, quoteAmountIn, fixedSide } = params;
  const { version } = poolKeys;

  if (version === 4 || version === 5) {
    const data = Buffer.alloc(addLiquidityLayout.span);
    addLiquidityLayout.encode(
      {
        instruction: 3,
        baseAmountIn: parseBigNumberish(baseAmountIn),
        quoteAmountIn: parseBigNumberish(quoteAmountIn),
        fixedSide: parseBigNumberish(fixedSide === "base" ? 0 : 1),
      },
      data,
    );

    const keys = [
      accountMeta({ pubkey: TOKEN_PROGRAM_ID, isWritable: false }),
      // amm
      accountMeta({ pubkey: poolKeys.id }),
      accountMeta({ pubkey: poolKeys.authority, isWritable: false }),
      accountMeta({ pubkey: poolKeys.openOrders, isWritable: false }),
      accountMeta({ pubkey: poolKeys.targetOrders }),
      accountMeta({ pubkey: poolKeys.lpMint }),
      accountMeta({ pubkey: poolKeys.baseVault }),
      accountMeta({ pubkey: poolKeys.quoteVault }),
    ];

    if (version === 5) {
      keys.push(accountMeta({ pubkey: MODEL_DATA_PUBKEY }));
    }

    keys.push(
      // serum
      accountMeta({ pubkey: poolKeys.marketId, isWritable: false }),
      // user
      accountMeta({ pubkey: userKeys.baseTokenAccount }),
      accountMeta({ pubkey: userKeys.quoteTokenAccount }),
      accountMeta({ pubkey: userKeys.lpTokenAccount }),
      accountMeta({ pubkey: userKeys.owner, isWritable: false, isSigner: true }),
      accountMeta({ pubkey: poolKeys.marketEventQueue, isWritable: false }),
    );

    return new TransactionInstruction({
      programId: poolKeys.programId,
      keys,
      data,
    });
  }

  logger.logWithError("invalid version", "poolKeys.version", version);
  return new TransactionInstruction({ programId: poolKeys.programId, keys: [] }); // won't reach
}

export function makeRemoveLiquidityInstruction(params: LiquidityRemoveInstructionParams): TransactionInstruction {
  const { poolKeys, userKeys, amountIn } = params;
  const { version } = poolKeys;

  if (version === 4 || version === 5) {
    const data = Buffer.alloc(removeLiquidityLayout.span);
    removeLiquidityLayout.encode(
      {
        instruction: 4,
        amountIn: parseBigNumberish(amountIn),
      },
      data,
    );

    const keys = [
      // system
      accountMeta({ pubkey: TOKEN_PROGRAM_ID, isWritable: false }),
      // amm
      accountMeta({ pubkey: poolKeys.id }),
      accountMeta({ pubkey: poolKeys.authority, isWritable: false }),
      accountMeta({ pubkey: poolKeys.openOrders }),
      accountMeta({ pubkey: poolKeys.targetOrders }),
      accountMeta({ pubkey: poolKeys.lpMint }),
      accountMeta({ pubkey: poolKeys.baseVault }),
      accountMeta({ pubkey: poolKeys.quoteVault }),
    ];

    if (version === 5) {
      keys.push(accountMeta({ pubkey: MODEL_DATA_PUBKEY }));
    } else {
      keys.push(accountMeta({ pubkey: poolKeys.withdrawQueue }), accountMeta({ pubkey: poolKeys.lpVault }));
    }

    keys.push(
      // serum
      accountMeta({ pubkey: poolKeys.marketProgramId, isWritable: false }),
      accountMeta({ pubkey: poolKeys.marketId }),
      accountMeta({ pubkey: poolKeys.marketBaseVault }),
      accountMeta({ pubkey: poolKeys.marketQuoteVault }),
      accountMeta({ pubkey: poolKeys.marketAuthority, isWritable: false }),
      // user
      accountMeta({ pubkey: userKeys.lpTokenAccount }),
      accountMeta({ pubkey: userKeys.baseTokenAccount }),
      accountMeta({ pubkey: userKeys.quoteTokenAccount }),
      accountMeta({ pubkey: userKeys.owner, isWritable: false, isSigner: true }),
      // serum orderbook
      accountMeta({ pubkey: poolKeys.marketEventQueue }),
      accountMeta({ pubkey: poolKeys.marketBids }),
      accountMeta({ pubkey: poolKeys.marketAsks }),
    );

    return new TransactionInstruction({
      programId: poolKeys.programId,
      keys,
      data,
    });
  }

  logger.logWithError("invalid version", "poolKeys.version", version);
  return new TransactionInstruction({ programId: poolKeys.programId, keys: [] }); // won't reach
}

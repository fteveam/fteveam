// import BN from 'bn.js';

// import { Spl, SPL_ACCOUNT_LAYOUT } from '../spl';
// import { TOKEN_PROGRAM_ID } from './id';

import {
  AccountInfo, Commitment, Connection, PublicKey, Transaction, TransactionInstruction,
} from "@solana/web3.js";
import { chunkArray } from "./lodash";
import { Logger } from "./logger";

const logger = new Logger("Common.Web3");

interface MultipleAccountsJsonRpcResponse {
  jsonrpc: string;
  id: string;
  error?: {
    code: number;
    message: string;
  };
  result: {
    context: { slot: number };
    value: { data: Array<string>; executable: boolean; lamports: number; owner: string; rentEpoch: number }[];
  };
}

export interface GetMultipleAccountsInfoConfig {
  batchRequest?: boolean;
  commitment?: Commitment;
}

export async function getMultipleAccountsInfo(
  connection: Connection,
  publicKeys: PublicKey[],
  config?: GetMultipleAccountsInfoConfig,
): Promise<(AccountInfo<Buffer> | null)[]> {
  const { batchRequest, commitment } = {
    // default
    ...{
      batchRequest: false,
    },
    // custom
    ...config,
  };

  const chunkedKeys = chunkArray(publicKeys, 100);
  let results: (AccountInfo<Buffer> | null)[][] = new Array(chunkedKeys.length).fill([]);

  if (batchRequest) {
    const batch = chunkedKeys.map((keys) => {
      const args = connection._buildArgs([keys.map((key) => key.toBase58())], commitment, "base64");
      return {
        methodName: "getMultipleAccounts",
        args,
      };
    });
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const unsafeResponse: MultipleAccountsJsonRpcResponse[] = await connection._rpcBatchRequest(batch);
    results = unsafeResponse.map((unsafeRes: MultipleAccountsJsonRpcResponse) => {
      if (unsafeRes.error) {
        return logger.throwError("failed to get info for multiple accounts", Logger.errors.RPC_ERROR, {
          message: unsafeRes.error.message,
        });
      }

      return unsafeRes.result.value.map((accountInfo) => {
        if (accountInfo) {
          const { data, executable, lamports, owner, rentEpoch } = accountInfo;

          if (data.length !== 2 && data[1] !== "base64") {
            return logger.throwError("info must be base64 encoded", Logger.errors.RPC_ERROR);
          }

          return {
            data: Buffer.from(data[0], "base64"),
            executable,
            lamports,
            owner: new PublicKey(owner),
            rentEpoch,
          };
        } else {
          return null;
        }
      });
    });
  } else {
    try {
      results = await Promise.all(chunkedKeys.map((keys) => connection.getMultipleAccountsInfo(keys, commitment)));
    } catch (error) {
      if (error instanceof Error) {
        return logger.throwError("failed to get info for multiple accounts", Logger.errors.RPC_ERROR, {
          message: error.message,
        });
      }
    }
  }

  return results.flat();
}

export async function getMultipleAccountsInfoWithCustomFlag<T extends { pubkey: PublicKey }>(
  connection: Connection,
  publicKeysWithCustomFlag: T[],
  config?: GetMultipleAccountsInfoConfig,
): Promise<({ accountInfo: AccountInfo<Buffer> | null } & T)[]> {
  const multipleAccountsInfo = await getMultipleAccountsInfo(
    connection,
    publicKeysWithCustomFlag.map((o) => o.pubkey),
    config,
  );

  return publicKeysWithCustomFlag.map((o, idx) => ({ ...o, accountInfo: multipleAccountsInfo[idx] }));
}

export interface GetTokenAccountsByOwnerConfig {
  commitment?: Commitment;
}

// export async function getTokenAccountsByOwner(
//   connection: Connection,
//   owner: PublicKey,
//   config?: GetTokenAccountsByOwnerConfig
// ) {
//   const defaultConfig = {};
//   const customConfig = { ...defaultConfig, ...config };

//   const solReq = connection.getAccountInfo(owner, customConfig.commitment);
//   const tokenReq = connection.getTokenAccountsByOwner(
//     owner,
//     {
//       programId: TOKEN_PROGRAM_ID
//     },
//     customConfig.commitment
//   );

//   const [solResp, tokenResp] = await Promise.all([solReq, tokenReq]);

//   const accounts: {
//     publicKey?: PublicKey;
//     mint?: PublicKey;
//     isAssociated?: boolean;
//     amount: BN;
//     isNative: boolean;
//   }[] = [];

//   for (const { pubkey, account } of tokenResp.value) {
//     // double check layout length
//     if (account.data.length !== SPL_ACCOUNT_LAYOUT.span) {
//       return logger.throwArgumentError('invalid token account layout length', 'publicKey', pubkey.toBase58());
//     }

//     const { mint, amount } = SPL_ACCOUNT_LAYOUT.decode(account.data);
//     const associatedTokenAddress = await Spl.getAssociatedTokenAddress({ mint, owner });

//     accounts.push({
//       publicKey: pubkey,
//       mint,
//       isAssociated: associatedTokenAddress.equals(pubkey),
//       amount,
//       isNative: false
//     });
//   }

//   if (solResp) {
//     accounts.push({
//       amount: new BN(solResp.lamports),
//       isNative: true
//     });
//   }

//   return accounts;
// }

// const PACKET_DATA_SIZE = 1280 - 40 - 8;

/**
 * Forecast transaction size
 */
export function forecastTransactionSize(instructions: TransactionInstruction[], signers: PublicKey[]) {
  if (instructions.length < 1) {
    return logger.throwArgumentError("no instructions provided", "instructions", instructions);
  }
  if (signers.length < 1) {
    return logger.throwArgumentError("no signers provided", "signers", signers);
  }

  const transaction = new Transaction({
    recentBlockhash: "11111111111111111111111111111111",
    feePayer: signers[0],
  });

  transaction.add(...instructions);

  const message = transaction.compileMessage().serialize();
  // SIGNATURE_LENGTH = 64
  const transactionLength = signers.length + signers.length * 64 + message.length;

  return transactionLength;
}

export async function getSimulateLogs(connection: Connection, instructions: TransactionInstruction[]) {
  const transaction = new Transaction({
    feePayer: new PublicKey("RaydiumSimuLateTransaction11111111111111111"),
  });

  for (const instruction of instructions) {
    transaction.add(instruction);
  }

  const { value } = await connection.simulateTransaction(transaction);
  const { logs, err } = value;

  return { logs, err };
}

export function parseSimulateLogs(logs: string[], key: string) {
  const log = logs.find((l) => l.includes(key));
  if (!log) {
    return logger.throwArgumentError("simulate logs fail to match key", "key", key);
  }

  const results = log.match(/{["\w:,]+}/g);
  if (!results || results.length !== 1) {
    return logger.throwArgumentError("simulate log fail to match json", "key", key);
  }

  return results[0];
}

export function getSimulateValue(log: string, key: string) {
  const reg = new RegExp(`"${key}":(\\d+)`, "g");

  const results = reg.exec(log);
  if (!results || results.length !== 2) {
    return logger.throwArgumentError("simulate log fail to match key", "key", key);
  }

  return results[1];
}

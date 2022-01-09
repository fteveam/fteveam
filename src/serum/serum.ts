import { PublicKey } from "@solana/web3.js";

import { Logger } from "../common";

import { SERUM_PROGRAMID_TO_VERSION, SERUM_VERSION_TO_PROGRAMID } from "./id";
import { MARKET_VERSION_TO_STATE_LAYOUT } from "./layout";

const logger = new Logger("Serum");

export class Market {
  /* ================= static functions ================= */
  static getProgramId(version: number) {
    const programId = SERUM_VERSION_TO_PROGRAMID[version];
    if (!programId) {
      return logger.throwArgumentError("invalid version", "version", version);
    }

    return programId;
  }

  static getVersion(programId: PublicKey) {
    const programIdString = programId.toBase58();

    const version = SERUM_PROGRAMID_TO_VERSION[programIdString];
    if (!version) {
      return logger.throwArgumentError("invalid program id", "programId", programIdString);
    }

    return version;
  }

  static getStateLayout(version: number) {
    const STATE_LAYOUT = MARKET_VERSION_TO_STATE_LAYOUT[version];
    if (!STATE_LAYOUT) {
      return logger.throwArgumentError("invalid version", "version", version);
    }

    return STATE_LAYOUT;
  }

  static getLayouts(version: number) {
    return { state: this.getStateLayout(version) };
  }

  static async getAssociatedAuthority({ programId, marketId }: { programId: PublicKey; marketId: PublicKey }) {
    const seeds = [marketId.toBuffer()];

    let nonce = 0;
    let publicKey: PublicKey;

    while (nonce < 100) {
      try {
        // Buffer.alloc(7) nonce u64
        const seedsWithNonce = seeds.concat(Buffer.from([nonce]), Buffer.alloc(7));
        publicKey = await PublicKey.createProgramAddress(seedsWithNonce, programId);
      } catch (err) {
        if (err instanceof TypeError) {
          throw err;
        }
        nonce++;
        continue;
      }
      return { publicKey, nonce };
    }

    return logger.throwArgumentError("unable to find a viable program address nonce", "params", {
      programId: programId.toBase58(),
      marketId: marketId.toBase58(),
    });
  }
}

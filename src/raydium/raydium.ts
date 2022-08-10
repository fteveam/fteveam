import { Connection, PublicKey } from "@solana/web3.js";
import { merge } from "lodash";

import { Api, ApiFarmPools, ApiLiquidityPools, ApiTokens } from "../api";
import { getTimestamp } from "../common";
import { Cluster } from "../solana";

import Account from "./account";
import Farm from "./farm";
import Liquidity from "./liquidity";

export interface RaydiumLoadParams {
  /* ================= solana ================= */
  // solana web3 connection
  connection: Connection;
  // solana cluster/network/env
  cluster?: Cluster;
  // user public key
  user?: PublicKey;
  /* ================= api ================= */
  // if provide tokens, the api request will be skipped on call Raydium.load
  // apiTokensCache?: Tokens;
  // if provide liquidity pools, the api request will be skipped on call Raydium.load
  // apiLiquidityPoolsCache?: LiquidityPools;
  // if provide farm pools, the api request will be skipped on call Raydium.load
  // apiFarmPoolsCache?: FarmPools;
  // TODO ETAG
  // api request interval in ms, -1 means never request again, 0 means always use fresh data, default is 5 mins (5 * 60 * 1000)
  apiRequestInterval?: number;
  // api request timeout in ms, default is 10 secs (10 * 1000)
  apiRequestTimeout?: number;
}

export interface RaydiumApiBatchRequestParams {
  // api instance
  api: Api;
  apiTokensCache?: ApiTokens;
  apiLiquidityPoolsCache?: ApiLiquidityPools;
  apiFarmPoolsCache?: ApiFarmPools;
}

export type RaydiumConstructorParams = Required<RaydiumLoadParams> & RaydiumApiBatchRequestParams;

export class Raydium {
  public connection: Connection;
  public cluster: Cluster;
  public user: PublicKey | null;
  public farm: Farm;
  public account: Account;
  public liqudity: Liquidity;
  public rawBalances: Map<string, string> = new Map();

  public api: Api;
  public apiCache: {
    tokens?: { fetched: number; data: ApiTokens };
    liquidityPools?: { fetched: number; data: ApiLiquidityPools };
    farmPools?: { fetched: number; data: ApiFarmPools };
  };

  constructor(config: RaydiumConstructorParams) {
    const { connection, cluster, user, api, apiTokensCache, apiLiquidityPoolsCache, apiFarmPoolsCache } = config;

    this.connection = connection;
    this.cluster = cluster;
    this.user = user;

    this.api = api;
    this.apiCache = {};
    this.farm = new Farm(this);
    this.account = new Account(this);
    this.liqudity = new Liquidity(this);

    // set api cache
    const now = getTimestamp();

    this.apiCache = {
      ...(apiTokensCache ? { tokens: { fetched: now, data: apiTokensCache } } : {}),
      ...(apiLiquidityPoolsCache ? { liquidityPools: { fetched: now, data: apiLiquidityPoolsCache } } : {}),
      ...(apiFarmPoolsCache ? { farmPools: { fetched: now, data: apiFarmPoolsCache } } : {}),
    };

    !apiTokensCache && this.fetchTokens();
  }

  static async load(config: RaydiumLoadParams): Promise<Raydium> {
    const custom: Required<RaydiumLoadParams> = merge(
      // default
      {
        cluster: "mainnet",
        user: null,
        apiRequestInterval: 5 * 60 * 1000,
        apiRequestTimeout: 10 * 1000,
      },
      config,
    );
    const { cluster, apiRequestTimeout } = custom;

    const api = new Api({ cluster, timeout: apiRequestTimeout });

    return new Raydium({
      ...custom,
      api,
    });
  }

  public async fetchTokens(forceUpdate?: boolean): Promise<ApiTokens> {
    if (this.apiCache.tokens && !forceUpdate) return this.apiCache.tokens.data;
    const data = await this.api.getTokens();
    this.apiCache.tokens = { fetched: Date.now(), data };

    return data;
  }

  public async fetchLiquidity(forceUpdate?: boolean): Promise<ApiLiquidityPools> {
    if (this.apiCache.liquidityPools && !forceUpdate) return this.apiCache.liquidityPools.data;
    const data = await this.api.getLiquidityPools();
    this.apiCache.liquidityPools = { fetched: Date.now(), data };
    return data;
  }

  public async fetchFarms(forceUpdate?: boolean): Promise<ApiFarmPools> {
    if (this.apiCache.farmPools && !forceUpdate) return this.apiCache.farmPools.data;
    const data = await this.api.getFarmPools();
    this.apiCache.farmPools = { fetched: Date.now(), data };
    return data;
  }
}

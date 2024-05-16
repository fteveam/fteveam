import axios, { AxiosInstance } from "axios";

import { createLogger, sleep } from "../common";
import { Cluster } from "../solana";

import {
  ApiClmmConfigInfo,
  ApiV3Token,
  FetchPoolParams,
  PoolsApiReturn,
  ApiV3PoolInfoItem,
  JupTokenType,
  PoolKeys,
  FormatFarmInfoOut,
  FormatFarmKeyOut,
  AvailabilityCheckAPI3,
} from "./type";
import { API_URLS, API_URL_CONFIG } from "./url";
import { updateReqHistory } from "./utils";
import { PublicKey } from "@solana/web3.js";

const logger = createLogger("Raydium_Api");
const poolKeysCache: Map<string, PoolKeys> = new Map();

export async function endlessRetry<T>(name: string, call: () => Promise<T>, interval = 1000): Promise<T> {
  let result: T | undefined;

  while (result == undefined) {
    try {
      logger.debug(`Request ${name} through endlessRetry`);
      result = await call();
    } catch (err) {
      logger.error(`Request ${name} failed, retry after ${interval} ms`, err);
      await sleep(interval);
    }
  }

  return result;
}

export interface ApiProps {
  cluster: Cluster;
  timeout: number;
  logRequests?: boolean;
  logCount?: number;
  urlConfigs?: API_URL_CONFIG;
}

export class Api {
  public cluster: Cluster;

  public api: AxiosInstance;
  public logCount: number;

  public urlConfigs: API_URL_CONFIG;

  constructor({ cluster, timeout, logRequests, logCount, urlConfigs }: ApiProps) {
    this.cluster = cluster;
    this.urlConfigs = urlConfigs || {};
    this.logCount = logCount || 1000;

    this.api = axios.create({ baseURL: this.urlConfigs.BASE_HOST || API_URLS.BASE_HOST, timeout });

    this.api.interceptors.request.use(
      (config) => {
        // before request
        const { method, baseURL, url } = config;

        logger.debug(`${method?.toUpperCase()} ${baseURL}${url}`);

        return config;
      },
      (error) => {
        // request error
        logger.error(`Request failed`);

        return Promise.reject(error);
      },
    );
    this.api.interceptors.response.use(
      (response) => {
        // 2xx
        const { config, data, status } = response;
        const { method, baseURL, url } = config;

        if (logRequests) {
          updateReqHistory({
            status,
            url: `${baseURL}${url}`,
            params: config.params,
            data,
            logCount: this.logCount,
          });
        }

        logger.debug(`${method?.toUpperCase()} ${baseURL}${url}  ${status}`);

        return data;
      },
      (error) => {
        // https://axios-http.com/docs/handling_errors
        // not 2xx
        const { config, response = {} } = error;
        const { status } = response;
        const { method, baseURL, url } = config;

        if (logRequests) {
          updateReqHistory({
            status,
            url: `${baseURL}${url}`,
            params: config.params,
            data: error.message,
            logCount: this.logCount,
          });
        }

        logger.error(`${method.toUpperCase()} ${baseURL}${url} ${status || error.message}`);

        return Promise.reject(error);
      },
    );
  }

  async getClmmConfigs(): Promise<ApiClmmConfigInfo[]> {
    const res = await this.api.get(this.urlConfigs.CLMM_CONFIG || API_URLS.CLMM_CONFIG);
    return res.data;
  }

  async getClmmPoolLines(poolId: string): Promise<{ price: string; liquidity: string }[]> {
    const res = await this.api.get(
      `${this.urlConfigs.POOL_LIQUIDITY_LINE || API_URLS.POOL_LIQUIDITY_LINE}?pool_id=${poolId}`,
    );
    return res.data;
  }

  async getBlockSlotCountForSecond(endpointUrl?: string): Promise<number> {
    if (!endpointUrl) return 2;
    const res: {
      id: string;
      jsonrpc: string;
      result: { numSlots: number; numTransactions: number; samplePeriodSecs: number; slot: number }[];
    } = await this.api.post(endpointUrl, {
      id: "getRecentPerformanceSamples",
      jsonrpc: "2.0",
      method: "getRecentPerformanceSamples",
      params: [4],
    });
    const slotList = res.result.map((data) => data.numSlots);
    return slotList.reduce((a, b) => a + b, 0) / slotList.length / 60;
  }

  async getChainTimeOffset(): Promise<{ offset: number }> {
    return this.api.get(this.urlConfigs.CHAIN_TIME || API_URLS.CHAIN_TIME);
  }

  async getRpcs(): Promise<{
    rpcs: { batch: boolean; name: string; url: string; weight: number }[];
    strategy: string;
  }> {
    return this.api.get(this.urlConfigs.RPCS || API_URLS.RPCS);
  }

  async getTokenList(): Promise<{ mintList: ApiV3Token[]; blacklist: ApiV3Token[] }> {
    const res = await this.api.get(this.urlConfigs.TOKEN_LIST || API_URLS.TOKEN_LIST);
    return res.data;
  }

  async getJupTokenList(type?: JupTokenType): Promise<ApiV3Token[]> {
    return this.api.get("/", {
      baseURL: (this.urlConfigs.JUP_TOKEN_LIST || API_URLS.JUP_TOKEN_LIST).replace("{type}", type || JupTokenType.ALL),
    });
  }

  async getTokenInfo(mint: (string | PublicKey)[]): Promise<ApiV3Token[]> {
    const res = await this.api.get(
      (this.urlConfigs.MINT_INFO_ID || API_URLS.MINT_INFO_ID) + `?mints=${mint.map((m) => m.toString()).join(",")}`,
    );
    return res.data;
  }

  async getPoolList(props: FetchPoolParams = {}): Promise<PoolsApiReturn> {
    const { type = "all", sort = "liquidity", order = "desc", page = 0, pageSize = 100 } = props;
    const res = await this.api.get<PoolsApiReturn>(
      (this.urlConfigs.POOL_LIST || API_URLS.POOL_LIST) +
        `?poolType=${type}&poolSortField=${sort}&sortType=${order}&page=${page}&pageSize=${pageSize}`,
    );
    return res.data;
  }

  async fetchPoolById(props: { ids: string }): Promise<ApiV3PoolInfoItem[]> {
    const { ids } = props;
    const res = await this.api.get((this.urlConfigs.POOL_SEARCH_BY_ID || API_URLS.POOL_SEARCH_BY_ID) + `?ids=${ids}`);
    return res.data;
  }

  async fetchPoolKeysById(props: { idList: string[] }): Promise<PoolKeys[]> {
    const { idList } = props;

    const cacheList: PoolKeys[] = [];

    const readyList = idList.filter((poolId) => {
      if (poolKeysCache.has(poolId)) {
        cacheList.push(poolKeysCache.get(poolId)!);
        return false;
      }
      return true;
    });

    let data: PoolKeys[] = [];
    if (readyList.length) {
      const res = await this.api.get<PoolKeys[]>(
        (this.urlConfigs.POOL_KEY_BY_ID || API_URLS.POOL_KEY_BY_ID) + `?ids=${readyList.join(",")}`,
      );
      data = res.data.filter(Boolean);
      data.forEach((poolKey) => {
        poolKeysCache.set(poolKey.id, poolKey);
      });
    }

    return cacheList.concat(data);
  }

  async fetchFarmInfoById(props: { ids: string }): Promise<FormatFarmInfoOut[]> {
    const { ids } = props;

    const res = await this.api.get<FormatFarmInfoOut[]>(
      (this.urlConfigs.FARM_INFO || API_URLS.FARM_INFO) + `?ids=${ids}`,
    );
    return res.data;
  }

  async fetchFarmKeysById(props: { ids: string }): Promise<FormatFarmKeyOut[]> {
    const { ids } = props;

    const res = await this.api.get<FormatFarmKeyOut[]>(
      (this.urlConfigs.FARM_KEYS || API_URLS.FARM_KEYS) + `?ids=${ids}`,
    );
    return res.data;
  }

  async fetchAvailabilityStatus(): Promise<AvailabilityCheckAPI3> {
    const res = await this.api.get<AvailabilityCheckAPI3>(
      this.urlConfigs.CHECK_AVAILABILITY || API_URLS.CHECK_AVAILABILITY,
    );
    return res.data;
  }
}

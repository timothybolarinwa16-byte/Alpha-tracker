"use strict";

/*
 * ALPHA TRACKER
 * Binance USDⓈ-M Futures Only
 *
 * HISTORICAL INSPECTION
 * -------------------
 * Uses Binance Futures klines rather than aggTrades.
 *
 * Default inspection timeframe:
 * 5 minutes
 *
 * Each candle provides:
 *
 * Total Volume
 * Taker Buy Volume
 *
 * Therefore:
 *
 * Buy Taker = Taker Buy Volume
 *
 * Buy Maker = Total Volume - Taker Buy Volume
 *
 * Taker - Maker =
 * Buy Taker - Buy Maker
 *
 *
 * LIVE FLOW
 * ---------
 * Still uses Futures aggTrade WebSocket.
 *
 *
 * FUTURE HISTORICAL PRICE ENGINE
 * ------------------------------
 * getHistoricalTradeBuckets() is retained.
 * It can later be replaced/extended with the
 * pair-specific price-distance + kline refinement
 * engine discussed separately.
 */


/* =========================================================
   BINANCE FUTURES EXCHANGE
========================================================= */

class BinanceFuturesExchange {

  constructor(symbol = "BTCUSDT") {

    this.symbol =
      String(symbol).toUpperCase();

    this.restBase =
      "https://fapi.binance.com/fapi/v1";

    this.websocketBase =
      "wss://fstream.binance.com/ws";

    this.tradeCallback =
      null;

    this.connectionCallback =
      null;

    this.socket =
      null;

    this.reconnectTimer =
      null;

    this.reconnectAttempts =
      0;

    this.manualDisconnect =
      false;

    this.futuresSymbols =
      null;

  }


  onTrade(callback) {

    this.tradeCallback =
      typeof callback === "function"
        ? callback
        : null;

  }


  onConnection(callback) {

    this.connectionCallback =
      typeof callback === "function"
        ? callback
        : null;

  }


  getSymbol() {

    return this.symbol;

  }


  setSymbol(symbol) {

    this.symbol =
      String(symbol).toUpperCase();

  }


  emitConnection(status) {

    if (
      this.connectionCallback
    ) {

      this.connectionCallback(
        status
      );

    }

  }


  async request(
    path,
    params = {},
    retryCount = 0
  ) {

    const query =
      new URLSearchParams();

    Object.entries(
      params
    ).forEach(
      ([key, value]) => {

        if (
          value !== undefined &&
          value !== null &&
          value !== ""
        ) {

          query.set(
            key,
            String(value)
          );

        }

      }
    );

    const queryString =
      query.toString();

    const url =
      queryString
        ? `${this.restBase}${path}?${queryString}`
        : `${this.restBase}${path}`;

    let response;

    try {

      response =
        await fetch(
          url
        );

    } catch (
      error
    ) {

      throw new Error(
        "Unable to connect to Binance Futures API"
      );

    }

    /*
     * Binance rate-limit protection.
     */

    if (
      response.status === 429
    ) {

      if (
        retryCount >= 5
      ) {

        throw new Error(
          "Binance Futures rate limit reached. Please wait and try again."
        );

      }

      const retryAfter =
        Number(
          response.headers.get(
            "Retry-After"
          )
        );

      const delay =
        Number.isFinite(
          retryAfter
        )
          ? retryAfter * 1000
          : 3000;

      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            delay
          )
      );

      return this.request(
        path,
        params,
        retryCount + 1
      );

    }

    let data;

    try {

      data =
        await response.json();

    } catch {

      throw new Error(
        `Binance Futures returned invalid data: HTTP ${response.status}`
      );

    }

    if (
      !response.ok
    ) {

      throw new Error(
        data?.msg ||
        `Binance Futures HTTP error ${response.status}`
      );

    }

    if (
      data &&
      typeof data.code === "number" &&
      data.code < 0
    ) {

      throw new Error(
        data.msg ||
        "Binance Futures API error"
      );

    }

    return data;

  }


  /* =======================================================
     FUTURES SYMBOLS
  ======================================================= */

  async getExchangeInfo() {

    if (
      Array.isArray(
        this.futuresSymbols
      )
    ) {

      return this.futuresSymbols;

    }

    const data =
      await this.request(
        "/exchangeInfo"
      );

    this.futuresSymbols =
      Array.isArray(
        data.symbols
      )
        ? data.symbols
            .filter(
              item =>
                item.status === "TRADING"
            )
            .map(
              item =>
                item.symbol.toUpperCase()
            )
        : [];

    return this.futuresSymbols;

  }


  async resolveSymbol(input) {

    const entered =
      String(input || "")
        .toUpperCase()
        .replace(
          /[^A-Z0-9]/g,
          ""
        );

    if (
      !entered
    ) {

      throw new Error(
        "Enter a Futures symbol"
      );

    }

    const symbols =
      await this.getExchangeInfo();

    if (
      symbols.includes(
        entered
      )
    ) {

      return entered;

    }

    const candidates = [

      `${entered}USDT`,

      `${entered}USDC`,

      `${entered}BUSD`

    ];

    const found =
      candidates.find(
        symbol =>
          symbols.includes(
            symbol
          )
      );

    if (
      found
    ) {

      return found;

    }

    throw new Error(
      `${entered} is not a currently trading Binance USDⓈ-M Futures pair`
    );

  }


  /* =======================================================
     TICKER
  ======================================================= */

  async get24hTicker(symbol) {

    return this.request(
      "/ticker/24hr",
      {
        symbol:
          String(symbol).toUpperCase()
      }
    );

  }


  /* =======================================================
     ORDER BOOK
  ======================================================= */

  async getOrderBook(
    symbol,
    limit = 1000
  ) {

    return this.request(
      "/depth",
      {
        symbol:
          String(symbol).toUpperCase(),

        limit
      }
    );

  }


  /* =======================================================
     OLD HISTORICAL AGGREGATE TRADE ENGINE
     
     RETAINED FOR FUTURE USE
     
     This is NOT used by Inspect Trades anymore.
     
     The future price-bucket engine can use this
     method for recent exact trade-level analysis.
  ======================================================= */

  async getHistoricalTradeBuckets(
    symbol,
    startTime,
    endTime,
    bucketSize,
    progressCallback = null
  ) {

    const groups =
      new Map();

    let fromId =
      null;

    let requests =
      0;

    let finished =
      false;

    let lastProcessedId =
      null;

    const normalizedSymbol =
      String(symbol).toUpperCase();

    while (
      !finished
    ) {

      const params = {

        symbol:
          normalizedSymbol,

        limit:
          1000

      };

      if (
        fromId === null
      ) {

        params.startTime =
          startTime;

        params.endTime =
          endTime;

      } else {

        params.fromId =
          fromId;

      }

      const batch =
        await this.request(
          "/aggTrades",
          params
        );

      requests++;

      if (
        typeof progressCallback ===
        "function"
      ) {

        progressCallback(
          requests,
          batch?.length || 0
        );

      }

      if (
        !Array.isArray(batch) ||
        !batch.length
      ) {

        break;

      }

      let reachedEnd =
        false;

      let newestTime =
        0;

      for (
        const raw of batch
      ) {

        const price =
          Number(
            raw.p
          );

        const quantity =
          Number(
            raw.q
          );

        const time =
          Number(
            raw.T
          );

        const tradeId =
          Number(
            raw.a
          );

        const buyerIsMaker =
          raw.m === true ||
          raw.m === "true";

        if (
          !Number.isFinite(price) ||
          !Number.isFinite(quantity) ||
          quantity <= 0 ||
          !Number.isFinite(time)
        ) {

          continue;

        }

        if (
          time > newestTime
        ) {

          newestTime =
            time;

        }

        if (
          time < startTime
        ) {

          continue;

        }

        if (
          time > endTime
        ) {

          reachedEnd =
            true;

          continue;

        }

        const bucket =
          Math.floor(
            price /
            bucketSize
          ) *
          bucketSize;

        const key =
          bucket.toFixed(
            12
          );

        if (
          !groups.has(
            key
          )
        ) {

          groups.set(
            key,
            {

              price:
                bucket,

              trades:
                0,

              volume:
                0,

              buyTaker:
                0,

              buyMaker:
                0,

              flow:
                0

            }
          );

        }

        const group =
          groups.get(
            key
          );

        group.trades++;

        group.volume +=
          quantity;

        if (
          !buyerIsMaker
        ) {

          group.buyTaker +=
            quantity;

        } else {

          group.buyMaker +=
            quantity;

        }

        group.flow =
          group.buyTaker -
          group.buyMaker;

      }

      if (
        reachedEnd ||
        newestTime >= endTime
      ) {

        finished =
          true;

        break;

      }

      const lastRaw =
        batch[
          batch.length - 1
        ];

      const lastBatchId =
        Number(
          lastRaw?.a
        );

      if (
        !Number.isFinite(
          lastBatchId
        )
      ) {

        break;

      }

      if (
        lastProcessedId !== null &&
        lastBatchId <=
          lastProcessedId
      ) {

        break;

      }

      lastProcessedId =
        lastBatchId;

      fromId =
        lastBatchId + 1;

      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            50
          )
      );

    }

    return Array.from(
      groups.values()
    ).sort(
      (
        first,
        second
      ) =>
        second.price -
        first.price
    );

  }


  /* =======================================================
     HISTORICAL FLOW SERIES
     
     NEW INSPECT TRADES ENGINE
     
     Uses Futures KLINES instead of aggTrades.
     
     Default interval:
     5 minutes
     
     Kline fields:
     
     [0]  Open time
     [1]  Open
     [2]  High
     [3]  Low
     [4]  Close
     [5]  Volume
     [6]  Close time
     [7]  Quote asset volume
     [8]  Number of trades
     [9]  Taker buy base asset volume
     [10] Taker buy quote asset volume
     
     Our interpretation:
     
     Buy Taker =
       Taker buy base asset volume
     
     Buy Maker =
       Total volume - Taker buy volume
     
     Taker - Maker =
       Buy Taker - Buy Maker
  ======================================================= */

  async getHistoricalFlowSeries(
    symbol,
    startTime,
    endTime,
    interval = "5m",
    progressCallback = null
  ) {

    const candles =
      [];

    const normalizedSymbol =
      String(symbol).toUpperCase();

    /*
     * Binance Futures kline interval
     * duration in milliseconds.
     *
     * Currently Inspect Trades uses
     * 5-minute candles.
     */

    const intervalMilliseconds =
      this.getKlineIntervalMilliseconds(
        interval
      );

    let currentStart =
      startTime;

    let requestNumber =
      0;

    let safetyCounter =
      0;

    /*
     * Prevent an unexpected pagination
     * condition from looping forever.
     */

    const maxRequests =
      10000;

    while (
      currentStart <= endTime &&
      safetyCounter < maxRequests
    ) {

      safetyCounter++;

      const batch =
        await this.request(
          "/klines",
          {

            symbol:
              normalizedSymbol,

            interval,

            startTime:
              currentStart,

            endTime,

            limit:
              1500

          }
        );

      requestNumber++;

      if (
        typeof progressCallback ===
        "function"
      ) {

        progressCallback(
          requestNumber,
          batch?.length || 0
        );

      }

      if (
        !Array.isArray(batch) ||
        !batch.length
      ) {

        break;

      }

      let lastOpenTime =
        null;

      for (
        const raw of batch
      ) {

        if (
          !Array.isArray(raw) ||
          raw.length < 10
        ) {

          continue;

        }

        const openTime =
          Number(
            raw[0]
          );

        const open =
          Number(
            raw[1]
          );

        const high =
          Number(
            raw[2]
          );

        const low =
          Number(
            raw[3]
          );

        const close =
          Number(
            raw[4]
          );

        const volume =
          Number(
            raw[5]
          );

        const closeTime =
          Number(
            raw[6]
          );

        const tradeCount =
          Number(
            raw[8]
          );

        const takerBuyVolume =
          Number(
            raw[9]
          );

        if (
          !Number.isFinite(
            openTime
          )
        ) {

          continue;

        }

        lastOpenTime =
          openTime;

        if (
          openTime < startTime ||
          openTime > endTime
        ) {

          continue;

        }

        if (
          !Number.isFinite(volume) ||
          !Number.isFinite(takerBuyVolume)
        ) {

          continue;

        }

        /*
         * Taker buy volume cannot logically
         * exceed total volume.
         *
         * Clamp only to protect against
         * malformed/precision edge cases.
         */

        const buyTaker =
          Math.min(
            Math.max(
              0,
              takerBuyVolume
            ),
            Math.max(
              0,
              volume
            )
          );

        /*
         * Under the framework being used:
         *
         * m:false
         * buyer = taker
         *
         * m:true
         * buyer = maker
         *
         * Therefore:
         *
         * Buy Maker =
         * total volume - Buy Taker
         */

        const buyMaker =
          Math.max(
            0,
            volume -
            buyTaker
          );

        const flow =
          buyTaker -
          buyMaker;

        candles.push({

          time:
            openTime,

          closeTime:
            Number.isFinite(
              closeTime
            )
              ? closeTime
              : (
                  openTime +
                  intervalMilliseconds -
                  1
                ),

          open:
            Number.isFinite(open)
              ? open
              : null,

          high:
            Number.isFinite(high)
              ? high
              : null,

          low:
            Number.isFinite(low)
              ? low
              : null,

          close:
            Number.isFinite(close)
              ? close
              : null,

          volume,

          buyTaker,

          buyMaker,

          flow,

          trades:
            Number.isFinite(
              tradeCount
            )
              ? tradeCount
              : 0

        });

      }

      /*
       * If the last returned candle already
       * reaches the requested end, stop.
       */

      if (
        Number.isFinite(
          lastOpenTime
        ) &&
        lastOpenTime >= endTime
      ) {

        break;

      }

      /*
       * If fewer than 1500 candles were returned,
       * Binance has exhausted the requested range.
       */

      if (
        batch.length < 1500
      ) {

        break;

      }

      if (
        !Number.isFinite(
          lastOpenTime
        )
      ) {

        break;

      }

      const nextStart =
        lastOpenTime +
        intervalMilliseconds;

      if (
        nextStart <=
        currentStart
      ) {

        break;

      }

      currentStart =
        nextStart;

    }

    /*
     * Remove accidental duplicates.
     */

    const unique =
      new Map();

    for (
      const candle of candles
    ) {

      unique.set(
        candle.time,
        candle
      );

    }

    return Array.from(
      unique.values()
    ).sort(
      (
        first,
        second
      ) =>
        first.time -
        second.time
    );

  }


  getKlineIntervalMilliseconds(
    interval
  ) {

    const value =
      String(
        interval || ""
      )
        .trim()
        .toLowerCase();

    const match =
      value.match(
        /^(\d+)([smhdwM])$/
      );

    if (
      !match
    ) {

      throw new Error(
        `Unsupported Futures kline interval: ${interval}`
      );

    }

    const amount =
      Number(
        match[1]
      );

    const unit =
      match[2];

    if (
      !Number.isFinite(amount) ||
      amount <= 0
    ) {

      throw new Error(
        `Invalid Futures kline interval: ${interval}`
      );

    }

    const multipliers = {

      s:
        1000,

      m:
        60 * 1000,

      h:
        60 * 60 * 1000,

      d:
        24 * 60 * 60 * 1000,

      w:
        7 * 24 * 60 * 60 * 1000,

      M:
        30 * 24 * 60 * 60 * 1000

    };

    return (
      amount *
      multipliers[unit]
    );

  }


  /* =======================================================
     LIVE TRADE NORMALIZATION
  ======================================================= */

  normalizeAggregateTrade(raw) {

    if (
      !raw
    ) {

      return null;

    }

    const price =
      Number(
        raw.p
      );

    const quantity =
      Number(
        raw.q
      );

    const time =
      Number(
        raw.T
      );

    const buyerIsMaker =
      raw.m === true ||
      raw.m === "true";

    if (
      !Number.isFinite(price) ||
      !Number.isFinite(quantity) ||
      quantity <= 0
    ) {

      return null;

    }

    return {

      id:
        Number(
          raw.a
        ),

      price,

      quantity,

      time:
        Number.isFinite(time)
          ? time
          : Date.now(),

      buyerIsMaker,

      aggressiveSide:
        buyerIsMaker
          ? "sell"
          : "buy"

    };

  }


  /* =======================================================
     LIVE WEBSOCKET
  ======================================================= */

  connectTradeStream(symbol) {

    this.disconnectTradeStream(
      false
    );

    this.symbol =
      String(symbol).toUpperCase();

    this.manualDisconnect =
      false;

    this.reconnectAttempts =
      0;

    this.openTradeSocket();

  }


  openTradeSocket() {

    if (
      this.manualDisconnect
    ) {

      return;

    }

    const symbol =
      this.symbol.toLowerCase();

    const url =
      `${this.websocketBase}/${symbol}@aggTrade`;

    try {

      this.socket =
        new WebSocket(
          url
        );

    } catch (
      error
    ) {

      console.error(
        "Futures WebSocket creation error:",
        error
      );

      this.emitConnection(
        "error"
      );

      this.scheduleReconnect();

      return;

    }

    this.socket.onopen =
      () => {

        this.reconnectAttempts =
          0;

        this.emitConnection(
          "connected"
        );

      };


    this.socket.onmessage =
      event => {

        try {

          const raw =
            JSON.parse(
              event.data
            );

          const trade =
            this.normalizeAggregateTrade(
              raw
            );

          if (
            trade &&
            this.tradeCallback
          ) {

            this.tradeCallback(
              trade
            );

          }

        } catch (
          error
        ) {

          console.error(
            "Futures trade message error:",
            error
          );

        }

      };


    this.socket.onerror =
      error => {

        console.error(
          "Futures WebSocket error:",
          error
        );

        this.emitConnection(
          "error"
        );

      };


    this.socket.onclose =
      () => {

        this.socket =
          null;

        if (
          !this.manualDisconnect
        ) {

          this.emitConnection(
            "disconnected"
          );

          this.scheduleReconnect();

        }

      };

  }


  scheduleReconnect() {

    if (
      this.manualDisconnect
    ) {

      return;

    }

    if (
      this.reconnectTimer
    ) {

      return;

    }

    this.reconnectAttempts++;

    const delay =
      Math.min(
        30000,
        1000 *
        Math.pow(
          2,
          Math.min(
            this.reconnectAttempts,
            5
          )
        )
      );

    this.reconnectTimer =
      setTimeout(
        () => {

          this.reconnectTimer =
            null;

          this.openTradeSocket();

        },
        delay
      );

  }


  disconnectTradeStream(
    manual = true
  ) {

    this.manualDisconnect =
      manual;

    if (
      this.reconnectTimer
    ) {

      clearTimeout(
        this.reconnectTimer
      );

      this.reconnectTimer =
        null;

    }

    if (
      this.socket
    ) {

      this.socket.onclose =
        null;

      this.socket.close();

      this.socket =
        null;

    }

  }

}


/* =========================================================
   STATE
========================================================= */

const state = {

  symbol:
    "BTCUSDT",

  exchange:
    null,

  liveTrades:
    0,

  liveBuyVolume:
    0,

  liveSellVolume:
    0,

  liveFlow:
    0,

  lastTradePrice:
    null,

  lastTradeTime:
    null,

  tradeHistory:
    [],

  symbolResolving:
    false

};


/* =========================================================
   DOM
========================================================= */

const els = {

  status:
    document.getElementById(
      "connectionStatus"
    ),

  pairInput:
    document.getElementById(
      "pairInput"
    ),

  marketPair:
    document.getElementById(
      "marketPair"
    ),

  currentPrice:
    document.getElementById(
      "currentPrice"
    ),

  priceChange:
    document.getElementById(
      "priceChange"
    ),

  volume24h:
    document.getElementById(
      "volume24h"
    ),

  tradeCount:
    document.getElementById(
      "tradeCount"
    ),

  tradeStart:
    document.getElementById(
      "tradeStart"
    ),

  tradeEnd:
    document.getElementById(
      "tradeEnd"
    ),

  priceBucket:
    document.getElementById(
      "priceBucket"
    ),

  inspectTradesBtn:
    document.getElementById(
      "inspectTradesBtn"
    ),

  tradeTableBody:
    document.getElementById(
      "tradeTableBody"
    ),

  buyVolume:
    document.getElementById(
      "buyVolume"
    ),

  sellVolume:
    document.getElementById(
      "sellVolume"
    ),

  netFlow:
    document.getElementById(
      "netFlow"
    ),

  volumeDensity:
    document.getElementById(
      "volumeDensity"
    ),

  orderBookRange:
    document.getElementById(
      "orderBookRange"
    ),

  orderBookLevels:
    document.getElementById(
      "orderBookLevels"
    ),

  loadOrderBookBtn:
    document.getElementById(
      "loadOrderBookBtn"
    ),

  asksBody:
    document.getElementById(
      "asksBody"
    ),

  bidsBody:
    document.getElementById(
      "bidsBody"
    ),

  cumulativeFlow:
    document.getElementById(
      "cumulativeFlow"
    ),

  densityIndicator:
    document.getElementById(
      "densityIndicator"
    ),

  makerBalance:
    document.getElementById(
      "makerBalance"
    ),

  tradeEfficiency:
    document.getElementById(
      "tradeEfficiency"
    ),

  lastUpdated:
    document.getElementById(
      "lastUpdated"
    )

};


/* =========================================================
   FORMATTING
========================================================= */

function formatNumber(
  value,
  decimals = 2
) {

  const number =
    Number(value);

  if (
    !Number.isFinite(number)
  ) {

    return "--";

  }

  return number.toLocaleString(
    undefined,
    {

      minimumFractionDigits:
        decimals,

      maximumFractionDigits:
        decimals

    }
  );

}


function formatPrice(value) {

  const number =
    Number(value);

  if (
    !Number.isFinite(number)
  ) {

    return "--";

  }

  if (
    number >= 1000
  ) {

    return number.toLocaleString(
      undefined,
      {

        minimumFractionDigits:
          2,

        maximumFractionDigits:
          2

      }
    );

  }

  if (
    number >= 1
  ) {

    return number.toFixed(
      4
    );

  }

  if (
    number >= 0.01
  ) {

    return number.toFixed(
      6
    );

  }

  return number.toFixed(
    8
  );

}


function formatVolume(value) {

  const number =
    Number(value);

  if (
    !Number.isFinite(number)
  ) {

    return "--";

  }

  if (
    Math.abs(number) >=
    1000000
  ) {

    return (
      number / 1000000
    ).toFixed(2) + "M";

  }

  if (
    Math.abs(number) >=
    1000
  ) {

    return (
      number / 1000
    ).toFixed(2) + "K";

  }

  return number.toFixed(
    4
  );

}


function normalizeSymbol(value) {

  return String(
    value || ""
  )
    .toUpperCase()
    .replace(
      /[^A-Z0-9]/g,
      ""
    );

}


/* =========================================================
   STATUS
========================================================= */

function setStatus(
  message,
  type = "disconnected"
) {

  if (
    !els.status
  ) {

    return;

  }

  els.status.textContent =
    message;

  els.status.classList.remove(
    "connected",
    "error",
    "disconnected"
  );

  els.status.classList.add(
    type
  );

}


/* =========================================================
   TICKER
========================================================= */

async function loadTicker() {

  try {

    if (
      !state.exchange
    ) {

      return;

    }

    const ticker =
      await state.exchange.get24hTicker(
        state.symbol
      );

    const tickerPrice =
      Number(
        ticker.lastPrice
      );

    if (
      els.currentPrice
    ) {

      els.currentPrice.textContent =
        formatPrice(
          tickerPrice
        );

    }

    if (
      els.priceChange
    ) {

      const percent =
        Number(
          ticker.priceChangePercent
        );

      els.priceChange.textContent =
        `${formatNumber(
          percent,
          2
        )}%`;

      els.priceChange.classList.remove(
        "positive",
        "negative"
      );

      els.priceChange.classList.add(
        percent >= 0
          ? "positive"
          : "negative"
      );

    }

    if (
      els.volume24h
    ) {

      els.volume24h.textContent =
        formatVolume(
          ticker.volume
        );

    }

    if (
      els.tradeCount
    ) {

      els.tradeCount.textContent =
        formatNumber(
          ticker.count,
          0
        );

    }

    if (
      !Number.isFinite(
        state.lastTradePrice
      ) &&
      Number.isFinite(
        tickerPrice
      )
    ) {

      state.lastTradePrice =
        tickerPrice;

    }

    if (
      els.lastUpdated
    ) {

      els.lastUpdated.textContent =
        `Last updated: ${
          new Date().toLocaleTimeString()
        }`;

    }

  } catch (
    error
  ) {

    console.error(
      "Futures ticker error:",
      error
    );

  }

}


/* =========================================================
   LIVE TRADE STATISTICS
========================================================= */

function resetTradeStats() {

  state.liveTrades =
    0;

  state.liveBuyVolume =
    0;

  state.liveSellVolume =
    0;

  state.liveFlow =
    0;

  state.lastTradePrice =
    null;

  state.lastTradeTime =
    null;

  state.tradeHistory =
    [];

  updateTradeDisplay();

}


function handleTrade(
  trade
) {

  if (
    !trade
  ) {

    return;

  }

  const price =
    Number(
      trade.price
    );

  const quantity =
    Number(
      trade.quantity
    );

  if (
    !Number.isFinite(price) ||
    !Number.isFinite(quantity) ||
    quantity <= 0
  ) {

    return;

  }

  state.liveTrades++;

  if (
    trade.aggressiveSide ===
    "buy"
  ) {

    state.liveBuyVolume +=
      quantity;

  } else {

    state.liveSellVolume +=
      quantity;

  }

  state.liveFlow =
    state.liveBuyVolume -
    state.liveSellVolume;

  state.lastTradePrice =
    price;

  state.lastTradeTime =
    Number(
      trade.time
    ) ||
    Date.now();

  state.tradeHistory.push({

    id:
      Number(
        trade.id
      ),

    price,

    quantity,

    time:
      state.lastTradeTime,

    aggressiveSide:
      trade.aggressiveSide,

    buyerIsMaker:
      trade.buyerIsMaker === true

  });

  if (
    state.tradeHistory.length >
    20000
  ) {

    state.tradeHistory.splice(
      0,
      state.tradeHistory.length -
        20000
    );

  }

  updateTradeDisplay();

}


function updateTradeDisplay() {

  if (
    els.buyVolume
  ) {

    els.buyVolume.textContent =
      formatVolume(
        state.liveBuyVolume
      );

  }

  if (
    els.sellVolume
  ) {

    els.sellVolume.textContent =
      formatVolume(
        state.liveSellVolume
      );

  }

  if (
    els.netFlow
  ) {

    els.netFlow.textContent =
      formatVolume(
        state.liveFlow
      );

  }

  const totalVolume =
    state.liveBuyVolume +
    state.liveSellVolume;

  const density =
    state.liveTrades > 0
      ? totalVolume /
        state.liveTrades
      : 0;

  if (
    els.volumeDensity
  ) {

    els.volumeDensity.textContent =
      formatVolume(
        density
      );

  }

  if (
    els.cumulativeFlow
  ) {

    els.cumulativeFlow.textContent =
      formatVolume(
        state.liveFlow
      );

  }

  if (
    els.densityIndicator
  ) {

    els.densityIndicator.textContent =
      formatVolume(
        density
      );

  }

  const balance =
    totalVolume > 0
      ? (
          (
            state.liveBuyVolume -
            state.liveSellVolume
          ) /
          totalVolume
        ) * 100
      : 0;

  if (
    els.makerBalance
  ) {

    els.makerBalance.textContent =
      `${formatNumber(
        balance,
        2
      )}%`;

  }

  if (
    els.tradeEfficiency
  ) {

    els.tradeEfficiency.textContent =
      Number.isFinite(
        state.lastTradePrice
      )
        ? formatPrice(
            state.lastTradePrice
          )
        : "--";

  }

}


/* =========================================================
   TIME HELPERS
========================================================= */

function getTimeValue(
  element
) {

  if (
    !element ||
    !element.value
  ) {

    return null;

  }

  const value =
    element.value;

  if (
    /^\d+$/.test(
      value
    )
  ) {

    const number =
      Number(
        value
      );

    return number <
      100000000000
      ? number * 1000
      : number;

  }

  const time =
    new Date(
      value
    ).getTime();

  return Number.isFinite(
    time
  )
    ? time
    : null;

}


function getInspectionWindow() {

  let start =
    getTimeValue(
      els.tradeStart
    );

  let end =
    getTimeValue(
      els.tradeEnd
    );

  const now =
    Date.now();

  if (
    !start &&
    !end
  ) {

    end =
      now;

    start =
      now -
      15 * 60 * 1000;

  }

  if (
    !start
  ) {

    start =
      now -
      15 * 60 * 1000;

  }

  if (
    !end
  ) {

    end =
      now;

  }

  if (
    start > end
  ) {

    const temporary =
      start;

    start =
      end;

    end =
      temporary;

  }

  return {

    start,

    end

  };

}


function getBucketSize() {

  const value =
    Number(
      els.priceBucket?.value
    );

  return Number.isFinite(
    value
  ) &&
    value > 0
    ? value
    : 0.2;

}


/* =========================================================
   INSPECT TRADES
     
   NOW TEMPORAL FLOW CHART
========================================================= */

async function inspectTrades() {

  if (
    !els.inspectTradesBtn ||
    !state.exchange
  ) {

    return;

  }

  els.inspectTradesBtn.disabled =
    true;

  els.inspectTradesBtn.textContent =
    "Loading Futures flow...";

  try {

    const {
      start,
      end
    } =
      getInspectionWindow();

    /*
     * Inspect Trades now uses 5-minute
     * Futures klines.
     *
     * This is dramatically lighter than
     * downloading every aggregate trade.
     */

    const series =
      await state.exchange.getHistoricalFlowSeries(
        state.symbol,
        start,
        end,
        "5m",
        (
          requestNumber,
          candleCount
        ) => {

          els.inspectTradesBtn.textContent =
            `Loading Futures... ${requestNumber} batches`;

          console.log(
            "Historical Futures kline batch:",
            requestNumber,
            candleCount
          );

        }
      );

    renderTradeFlowChart(
      series
    );

  } catch (
    error
  ) {

    console.error(
      "Futures historical flow error:",
      error
    );

    renderTradeFlowError(
      error.message ||
      "Unable to load Futures historical flow"
    );

  } finally {

    els.inspectTradesBtn.disabled =
      false;

    els.inspectTradesBtn.textContent =
      "Inspect Trades";

  }

}


/* =========================================================
   TRADE FLOW CHART CONTAINER
========================================================= */

function getTradeChartContainer() {

  let container =
    document.getElementById(
      "tradeFlowChart"
    );

  if (
    container
  ) {

    return container;

  }

  const tableBody =
    els.tradeTableBody;

  if (
    !tableBody
  ) {

    return null;

  }

  const table =
    tableBody.closest(
      "table"
    );

  if (
    !table
  ) {

    return null;

  }

  container =
    document.createElement(
      "div"
    );

  container.id =
    "tradeFlowChart";

  container.style.width =
    "100%";

  container.style.height =
    "420px";

  container.style.position =
    "relative";

  container.style.marginTop =
    "12px";

  table.parentElement.insertBefore(
    container,
    table
  );

  /*
   * Keep the old table in the DOM,
   * but hide it because Inspect Trades
   * is now represented by the chart.
   */

  table.style.display =
    "none";

  return container;

}


/* =========================================================
   TRADE FLOW CHART
========================================================= */

function renderTradeFlowChart(
  series
) {

  const container =
    getTradeChartContainer();

  if (
    !container
  ) {

    return;

  }

  container.innerHTML =
    "";

  if (
    !Array.isArray(series) ||
    !series.length
  ) {

    container.innerHTML = `
      <div style="
        padding:24px;
        text-align:center;
        opacity:.7;
      ">
        No flow data found for this window.
      </div>
    `;

    return;

  }

  /*
   * Store the series on the container.
   * This lets the resize handler redraw
   * the chart without another API call.
   */

  container._flowSeries =
    series;

  drawTradeFlowCanvas(
    container,
    series
  );

}


/* =========================================================
   DRAW FLOW CANVAS
========================================================= */

function drawTradeFlowCanvas(
  container,
  series
) {

  if (
    !container ||
    !Array.isArray(series) ||
    !series.length
  ) {

    return;

  }

  container.innerHTML =
    "";

  const canvas =
    document.createElement(
      "canvas"
    );

  canvas.style.width =
    "100%";

  canvas.style.height =
    "100%";

  canvas.style.display =
    "block";

  container.appendChild(
    canvas
  );

  const rect =
    container.getBoundingClientRect();

  const width =
    Math.max(
      320,
      rect.width
    );

  const height =
    Math.max(
      300,
      rect.height
    );

  const dpr =
    window.devicePixelRatio ||
    1;

  canvas.width =
    width * dpr;

  canvas.height =
    height * dpr;

  const ctx =
    canvas.getContext(
      "2d"
    );

  if (
    !ctx
  ) {

    return;

  }

  ctx.scale(
    dpr,
    dpr
  );

  const padding = {

    left:
      72,

    right:
      20,

    top:
      42,

    bottom:
      48

  };

  const chartWidth =
    Math.max(
      1,
      width -
      padding.left -
      padding.right
    );

  const chartHeight =
    Math.max(
      1,
      height -
      padding.top -
      padding.bottom
    );

  /*
   * Gather all values so all three
   * lines share one scale.
   */

  const values =
    [];

  for (
    const candle of series
  ) {

    values.push(
      Number(
        candle.buyTaker
      ) || 0
    );

    values.push(
      Number(
        candle.buyMaker
      ) || 0
    );

    values.push(
      Number(
        candle.flow
      ) || 0
    );

  }

  let min =
    Math.min(
      ...values
    );

  let max =
    Math.max(
      ...values
    );

  if (
    !Number.isFinite(min)
  ) {

    min =
      -1;

  }

  if (
    !Number.isFinite(max)
  ) {

    max =
      1;

  }

  if (
    min === max
  ) {

    const expansion =
      Math.abs(min) > 0
        ? Math.abs(min) * 0.1
        : 1;

    min -=
      expansion;

    max +=
      expansion;

  }

  const range =
    max -
    min;

  min -=
    range * 0.08;

  max +=
    range * 0.08;


  function xPosition(
    index
  ) {

    if (
      series.length <= 1
    ) {

      return (
        padding.left +
        chartWidth / 2
      );

    }

    return (
      padding.left +
      (
        index /
        (series.length - 1)
      ) *
      chartWidth
    );

  }


  function yPosition(
    value
  ) {

    return (
      padding.top +
      (
        1 -
        (
          (
            value -
            min
          ) /
          (
            max -
            min
          )
        )
      ) *
      chartHeight
    );

  }


  /* =======================================================
     BACKGROUND
  ======================================================= */

  ctx.clearRect(
    0,
    0,
    width,
    height
  );


  /* =======================================================
     GRID
  ======================================================= */

  ctx.font =
    "11px sans-serif";

  ctx.textAlign =
    "right";

  ctx.textBaseline =
    "middle";

  for (
    let index = 0;
    index <= 4;
    index++
  ) {

    const value =
      max -
      (
        (
          max -
          min
        ) *
        index /
        4
      );

    const y =
      yPosition(
        value
      );

    ctx.beginPath();

    ctx.moveTo(
      padding.left,
      y
    );

    ctx.lineTo(
      width -
      padding.right,
      y
    );

    ctx.strokeStyle =
      "rgba(128,128,128,0.20)";

    ctx.lineWidth =
      1;

    ctx.stroke();

    ctx.fillStyle =
      "rgba(128,128,128,0.90)";

    ctx.fillText(
      formatVolume(
        value
      ),
      padding.left - 8,
      y
    );

  }


  /* =======================================================
     ZERO LINE
  ======================================================= */

  if (
    min <= 0 &&
    max >= 0
  ) {

    const zeroY =
      yPosition(
        0
      );

    ctx.beginPath();

    ctx.moveTo(
      padding.left,
      zeroY
    );

    ctx.lineTo(
      width -
      padding.right,
      zeroY
    );

    ctx.strokeStyle =
      "rgba(128,128,128,0.55)";

    ctx.lineWidth =
      1;

    ctx.stroke();

  }


  /* =======================================================
     DRAW SERIES
  ======================================================= */

  function drawLine(
    accessor,
    lineColor,
    lineWidth = 2
  ) {

    ctx.beginPath();

    series.forEach(
      (
        candle,
        index
      ) => {

        const rawValue =
          Number(
            accessor(
              candle
            )
          );

        const value =
          Number.isFinite(
            rawValue
          )
            ? rawValue
            : 0;

        const x =
          xPosition(
            index
          );

        const y =
          yPosition(
            value
          );

        if (
          index === 0
        ) {

          ctx.moveTo(
            x,
            y
          );

        } else {

          ctx.lineTo(
            x,
            y
          );

        }

      }
    );

    ctx.strokeStyle =
      lineColor;

    ctx.lineWidth =
      lineWidth;

    ctx.lineJoin =
      "round";

    ctx.lineCap =
      "round";

    ctx.stroke();

  }


  /*
   * Buy Taker
   */

  drawLine(
    candle =>
      candle.buyTaker,
    "#22c55e",
    2
  );


  /*
   * Buy Maker
   */

  drawLine(
    candle =>
      candle.buyMaker,
    "#ef4444",
    2
  );


  /*
   * Taker - Maker
   *
   * Slightly thicker so the derived
   * directional-flow line is easy to follow.
   */

  drawLine(
    candle =>
      candle.flow,
    "#3b82f6",
    2.5
  );


  /* =======================================================
     X-AXIS
  ======================================================= */

  ctx.fillStyle =
    "rgba(128,128,128,0.90)";

  ctx.textAlign =
    "center";

  ctx.textBaseline =
    "top";

  const labelCount =
    Math.min(
      7,
      series.length
    );

  for (
    let index = 0;
    index < labelCount;
    index++
  ) {

    const seriesIndex =
      labelCount === 1
        ? 0
        : Math.round(
            index *
            (
              (
                series.length -
                1
              ) /
              (
                labelCount -
                1
              )
            )
          );

    const candle =
      series[
        seriesIndex
      ];

    const date =
      new Date(
        candle.time
      );

    const label =
      date.toLocaleTimeString(
        [],
        {

          hour:
            "2-digit",

          minute:
            "2-digit"

        }
      );

    ctx.fillText(
      label,
      xPosition(
        seriesIndex
      ),
      height -
      padding.bottom +
      12
    );

  }


  /* =======================================================
     LEGEND
  ======================================================= */

  const legend = [

    {

      label:
        "Buy Taker",

      color:
        "#22c55e"

    },

    {

      label:
        "Buy Maker",

      color:
        "#ef4444"

    },

    {

      label:
        "Taker - Maker",

      color:
        "#3b82f6"

    }

  ];

  let legendX =
    padding.left;

  const legendY =
    18;

  ctx.textAlign =
    "left";

  ctx.textBaseline =
    "middle";

  ctx.font =
    "12px sans-serif";

  for (
    const item of legend
  ) {

    ctx.beginPath();

    ctx.moveTo(
      legendX,
      legendY
    );

    ctx.lineTo(
      legendX + 14,
      legendY
    );

    ctx.strokeStyle =
      item.color;

    ctx.lineWidth =
      3;

    ctx.stroke();

    ctx.fillStyle =
      "rgba(128,128,128,0.95)";

    ctx.fillText(
      item.label,
      legendX + 20,
      legendY
    );

    legendX +=
      20 +
      ctx.measureText(
        item.label
      ).width +
      24;

  }


  /* =======================================================
     TOOLTIP
     
     Basic native canvas hover tooltip.
  ======================================================= */

  let tooltip =
    container.querySelector(
      ".trade-flow-tooltip"
    );

  if (
    !tooltip
  ) {

    tooltip =
      document.createElement(
        "div"
      );

    tooltip.className =
      "trade-flow-tooltip";

    tooltip.style.position =
      "absolute";

    tooltip.style.pointerEvents =
      "none";

    tooltip.style.display =
      "none";

    tooltip.style.padding =
      "8px 10px";

    tooltip.style.borderRadius =
      "6px";

    tooltip.style.background =
      "rgba(0,0,0,0.85)";

    tooltip.style.color =
      "#fff";

    tooltip.style.fontSize =
      "12px";

    tooltip.style.lineHeight =
      "1.5";

    tooltip.style.zIndex =
      "10";

    container.appendChild(
      tooltip
    );

  }


  canvas.onmousemove =
    event => {

      if (
        !series.length
      ) {

        return;

      }

      const bounds =
        canvas.getBoundingClientRect();

      const mouseX =
        event.clientX -
        bounds.left;

      const relativeX =
        mouseX -
        padding.left;

      if (
        relativeX < 0 ||
        relativeX > chartWidth
      ) {

        tooltip.style.display =
          "none";

        return;

      }

      const ratio =
        series.length <= 1
          ? 0
          : relativeX /
            chartWidth;

      const index =
        Math.max(
          0,
          Math.min(
            series.length - 1,
            Math.round(
              ratio *
              (
                series.length -
                1
              )
            )
          )
        );

      const candle =
        series[index];

      if (
        !candle
      ) {

        tooltip.style.display =
          "none";

        return;

      }

      const date =
        new Date(
          candle.time
        );

      const timeLabel =
        date.toLocaleString(
          [],
          {

            month:
              "short",

            day:
              "numeric",

            hour:
              "2-digit",

            minute:
              "2-digit"

          }
        );

      tooltip.innerHTML = `

        <strong>
          ${timeLabel}
        </strong>

        <br>

        Buy Taker:
        ${formatVolume(
          candle.buyTaker
        )}

        <br>

        Buy Maker:
        ${formatVolume(
          candle.buyMaker
        )}

        <br>

        Taker - Maker:
        ${formatVolume(
          candle.flow
        )}

      `;

      let left =
        mouseX + 12;

      let top =
        event.clientY -
        bounds.top +
        12;

      const tooltipWidth =
        tooltip.offsetWidth;

      const tooltipHeight =
        tooltip.offsetHeight;

      if (
        left +
        tooltipWidth >
        width
      ) {

        left =
          mouseX -
          tooltipWidth -
          12;

      }

      if (
        top +
        tooltipHeight >
        height
      ) {

        top =
          height -
          tooltipHeight -
          8;

      }

      tooltip.style.left =
        `${Math.max(
          4,
          left
        )}px`;

      tooltip.style.top =
        `${Math.max(
          4,
          top
        )}px`;

      tooltip.style.display =
        "block";

    };


  canvas.onmouseleave =
    () => {

      tooltip.style.display =
        "none";

    };

}


/* =========================================================
   CHART ERROR
========================================================= */

function renderTradeFlowError(
  message
) {

  const container =
    getTradeChartContainer();

  if (
    !container
  ) {

    return;

  }

  container.innerHTML = `
    <div style="
      padding:24px;
      text-align:center;
      opacity:.75;
    ">
      ${message}
    </div>
  `;

}


/* =========================================================
   CHART RESIZE
========================================================= */

let tradeFlowResizeTimer =
  null;

window.addEventListener(
  "resize",
  () => {

    clearTimeout(
      tradeFlowResizeTimer
    );

    tradeFlowResizeTimer =
      setTimeout(
        () => {

          const container =
            document.getElementById(
              "tradeFlowChart"
            );

          if (
            container &&
            Array.isArray(
              container._flowSeries
            ) &&
            container._flowSeries.length
          ) {

            drawTradeFlowCanvas(
              container,
              container._flowSeries
            );

          }

        },
        150
      );

  }
);


/* =========================================================
   ORDER BOOK TOTALS
========================================================= */

function createOrderBookTotals() {

  if (
    !els.asksBody
  ) {

    return;

  }

  const section =
    els.asksBody.closest(
      ".panel"
    ) ||
    els.asksBody.parentElement;

  if (
    !section
  ) {

    return;

  }

  if (
    document.getElementById(
      "orderBookTotals"
    )
  ) {

    return;

  }

  const totals =
    document.createElement(
      "div"
    );

  totals.id =
    "orderBookTotals";

  totals.style.display =
    "grid";

  totals.style.gridTemplateColumns =
    "1fr 1fr";

  totals.style.gap =
    "10px";

  totals.style.margin =
    "12px 0";

  totals.innerHTML = `

    <div class="metric-card">

      <div class="metric-label">
        Total Ask Quantity
      </div>

      <div id="totalAskQuantity">
        --
      </div>

    </div>

    <div class="metric-card">

      <div class="metric-label">
        Total Bid Quantity
      </div>

      <div id="totalBidQuantity">
        --
      </div>

    </div>

  `;

  section.insertBefore(
    totals,
    section.firstChild
  );

}


function normalizeBookLevel(
  level
) {

  if (
    Array.isArray(level)
  ) {

    const price =
      Number(
        level[0]
      );

    const quantity =
      Number(
        level[1]
      );

    if (
      !Number.isFinite(price) ||
      !Number.isFinite(quantity)
    ) {

      return null;

    }

    return {

      price,

      quantity

    };

  }

  if (
    level &&
    typeof level === "object"
  ) {

    const price =
      Number(
        level.price
      );

    const quantity =
      Number(
        level.quantity ??
        level.qty
      );

    if (
      !Number.isFinite(price) ||
      !Number.isFinite(quantity)
    ) {

      return null;

    }

    return {

      price,

      quantity

    };

  }

  return null;

}


function getOrderBookReferencePrice() {

  const livePrice =
    Number(
      state.lastTradePrice
    );

  if (
    Number.isFinite(livePrice) &&
    livePrice > 0
  ) {

    return livePrice;

  }

  const displayedPrice =
    Number(
      String(
        els.currentPrice?.textContent ||
        ""
      ).replace(
        /[^0-9.-]/g,
        ""
      )
    );

  if (
    Number.isFinite(
      displayedPrice
    ) &&
    displayedPrice > 0
  ) {

    return displayedPrice;

  }

  return 0;

}


/* =========================================================
   ORDER BOOK ZONES
========================================================= */

function createOrderBookZones(
  cmp,
  spacingPercent,
  levels,
  side
) {

  const price =
    Number(
      cmp
    );

  const spacing =
    Number(
      spacingPercent
    ) / 100;

  const count =
    Math.max(
      1,
      Math.min(
        100,
        Number(levels) ||
          10
      )
    );

  const zones =
    [];

  for (
    let index = 0;
    index < count;
    index++
  ) {

    const startPercent =
      spacing *
      index;

    const endPercent =
      spacing *
      (index + 1);

    let lower;

    let upper;

    if (
      side === "asks"
    ) {

      lower =
        price *
        (
          1 +
          startPercent
        );

      upper =
        price *
        (
          1 +
          endPercent
        );

    } else {

      lower =
        price *
        (
          1 -
          endPercent
        );

      upper =
        price *
        (
          1 -
          startPercent
        );

    }

    zones.push({

      level:
        index + 1,

      lower,

      upper,

      quantity:
        0,

      value:
        0,

      rawLevels:
        0

    });

  }

  return zones;

}


function aggregateOrderBookLevels(
  rawLevels,
  zones,
  side
) {

  for (
    const level of rawLevels
  ) {

    const price =
      Number(
        level.price
      );

    const quantity =
      Number(
        level.quantity
      );

    if (
      !Number.isFinite(price) ||
      !Number.isFinite(quantity) ||
      price <= 0 ||
      quantity <= 0
    ) {

      continue;

    }

    for (
      const zone of zones
    ) {

      let inside =
        false;

      if (
        side === "asks"
      ) {

        inside =
          price >= zone.lower &&
          price < zone.upper;

      } else {

        inside =
          price > zone.lower &&
          price <= zone.upper;

      }

      if (
        !inside
      ) {

        continue;

      }

      zone.quantity +=
        quantity;

      zone.value +=
        price *
        quantity;

      zone.rawLevels++;

      break;

    }

  }

  return zones;

}


function formatOrderBookZone(
  zone
) {

  return `${formatPrice(
    zone.lower
  )} - ${formatPrice(
    zone.upper
  )}`;

}


function renderOrderBookSide(
  body,
  zones
) {

  if (
    !body
  ) {

    return;

  }

  body.innerHTML =
    "";

  const fragment =
    document.createDocumentFragment();

  for (
    const zone of zones
  ) {

    const row =
      document.createElement(
        "tr"
      );

    row.innerHTML = `

      <td>
        ${formatOrderBookZone(
          zone
        )}
      </td>

      <td>
        ${formatVolume(
          zone.quantity
        )}
      </td>

      <td>
        ${formatVolume(
          zone.value
        )}
      </td>

    `;

    fragment.appendChild(
      row
    );

  }

  body.appendChild(
    fragment
  );

}


function updateOrderBookTotals(
  asks,
  bids
) {

  const askTotal =
    asks.reduce(
      (
        total,
        zone
      ) =>
        total +
        zone.quantity,
      0
    );

  const bidTotal =
    bids.reduce(
      (
        total,
        zone
      ) =>
        total +
        zone.quantity,
      0
    );

  const askElement =
    document.getElementById(
      "totalAskQuantity"
    );

  const bidElement =
    document.getElementById(
      "totalBidQuantity"
    );

  if (
    askElement
  ) {

    askElement.textContent =
      formatVolume(
        askTotal
      );

  }

  if (
    bidElement
  ) {

    bidElement.textContent =
      formatVolume(
        bidTotal
      );

  }

}


/* =========================================================
   LOAD ORDER BOOK
========================================================= */

async function loadOrderBook() {

  if (
    !state.exchange
  ) {

    return;

  }

  if (
    els.loadOrderBookBtn
  ) {

    els.loadOrderBookBtn.disabled =
      true;

    els.loadOrderBookBtn.textContent =
      "Loading Futures book...";

  }

  try {

    const book =
      await state.exchange.getOrderBook(
        state.symbol,
        1000
      );

    const asks =
      (
        book.asks ||
        []
      )
        .map(
          normalizeBookLevel
        )
        .filter(
          Boolean
        )
        .filter(
          level =>
            level.price > 0 &&
            level.quantity > 0
        );

    const bids =
      (
        book.bids ||
        []
      )
        .map(
          normalizeBookLevel
        )
        .filter(
          Boolean
        )
        .filter(
          level =>
            level.price > 0 &&
            level.quantity > 0
        );

    const cmp =
      getOrderBookReferencePrice();

    if (
      !Number.isFinite(cmp) ||
      cmp <= 0
    ) {

      throw new Error(
        "Current Futures market price unavailable"
      );

    }

    const spacingPercent =
      Math.max(
        0.0001,
        Number(
          els.orderBookRange?.value
        ) ||
          0.2
      );

    const levels =
      Math.max(
        1,
        Math.min(
          100,
          Number(
            els.orderBookLevels?.value
          ) ||
            10
        )
      );

    const askZones =
      createOrderBookZones(
        cmp,
        spacingPercent,
        levels,
        "asks"
      );

    const bidZones =
      createOrderBookZones(
        cmp,
        spacingPercent,
        levels,
        "bids"
      );

    aggregateOrderBookLevels(
      asks,
      askZones,
      "asks"
    );

    aggregateOrderBookLevels(
      bids,
      bidZones,
      "bids"
    );

    renderOrderBookSide(
      els.asksBody,
      askZones
    );

    renderOrderBookSide(
      els.bidsBody,
      bidZones
    );

    updateOrderBookTotals(
      askZones,
      bidZones
    );

  } catch (
    error
  ) {

    console.error(
      "Futures order-book error:",
      error
    );

    if (
      els.asksBody
    ) {

      els.asksBody.innerHTML = `
        <tr>
          <td colspan="3">
            Unable to load Futures order book.
          </td>
        </tr>
      `;

    }

    if (
      els.bidsBody
    ) {

      els.bidsBody.innerHTML = `
        <tr>
          <td colspan="3">
            Unable to load Futures order book.
          </td>
        </tr>
      `;

    }

    updateOrderBookTotals(
      [],
      []
    );

  } finally {

    if (
      els.loadOrderBookBtn
    ) {

      els.loadOrderBookBtn.disabled =
        false;

      els.loadOrderBookBtn.textContent =
        "Load Order Book";

    }

  }

}


/* =========================================================
   CONNECTION STATUS
========================================================= */

function handleConnection(
  status
) {

  if (
    status === "connected"
  ) {

    setStatus(
      "Binance Futures trade stream live",
      "connected"
    );

    return;

  }

  if (
    status === "error"
  ) {

    setStatus(
      "Binance Futures trade stream error",
      "error"
    );

    return;

  }

  setStatus(
    "Reconnecting to Binance Futures...",
    "disconnected"
  );

}


/* =========================================================
   CLEAR TABLES
========================================================= */

function clearMarketTables() {

  if (
    els.tradeTableBody
  ) {

    els.tradeTableBody.innerHTML = `
      <tr>
        <td colspan="6">
          No trade data loaded.
        </td>
      </tr>
    `;

  }

  const chart =
    document.getElementById(
      "tradeFlowChart"
    );

  if (
    chart
  ) {

    chart.innerHTML =
      "";

    chart._flowSeries =
      [];

  }

  if (
    els.asksBody
  ) {

    els.asksBody.innerHTML = `
      <tr>
        <td colspan="3">
          No data
        </td>
      </tr>
    `;

  }

  if (
    els.bidsBody
  ) {

    els.bidsBody.innerHTML = `
      <tr>
        <td colspan="3">
          No data
        </td>
      </tr>
    `;

  }

  const askTotal =
    document.getElementById(
      "totalAskQuantity"
    );

  const bidTotal =
    document.getElementById(
      "totalBidQuantity"
    );

  if (
    askTotal
  ) {

    askTotal.textContent =
      "--";

  }

  if (
    bidTotal
  ) {

    bidTotal.textContent =
      "--";

  }

}


/* =========================================================
   CHANGE PAIR
========================================================= */

async function changePair() {

  if (
    state.symbolResolving
  ) {

    return;

  }

  if (
    !state.exchange
  ) {

    return;

  }

  const entered =
    normalizeSymbol(
      els.pairInput?.value
    );

  if (
    !entered
  ) {

    return;

  }

  state.symbolResolving =
    true;

  if (
    els.pairInput
  ) {

    els.pairInput.disabled =
      true;

  }

  setStatus(
    "Resolving Binance Futures pair...",
    "disconnected"
  );

  try {

    const symbol =
      await state.exchange.resolveSymbol(
        entered
      );

    const oldSymbol =
      state.exchange.getSymbol();

    const symbolChanged =
      oldSymbol !== symbol;

    if (
      symbolChanged
    ) {

      state.exchange.disconnectTradeStream(
        false
      );

    }

    state.symbol =
      symbol;

    state.exchange.setSymbol(
      symbol
    );

    if (
      els.pairInput
    ) {

      els.pairInput.value =
        symbol;

    }

    if (
      els.marketPair
    ) {

      els.marketPair.textContent =
        symbol;

    }

    resetTradeStats();

    clearMarketTables();

    await loadTicker();

    state.exchange.connectTradeStream(
      symbol
    );

    setStatus(
      `Loading Binance Futures: ${symbol}`,
      "disconnected"
    );

    await loadOrderBook();

  } catch (
    error
  ) {

    console.error(
      "Futures pair change error:",
      error
    );

    setStatus(
      error.message ||
        "Invalid Binance Futures pair",
      "error"
    );

  } finally {

    state.symbolResolving =
      false;

    if (
      els.pairInput
    ) {

      els.pairInput.disabled =
        false;

    }

  }

}


/* =========================================================
   EVENTS
========================================================= */

document
  .getElementById(
    "loadPairBtn"
  )
  ?.addEventListener(
    "click",
    changePair
  );


els.pairInput?.addEventListener(
  "keydown",
  event => {

    if (
      event.key === "Enter"
    ) {

      changePair();

    }

  }
);


els.inspectTradesBtn?.addEventListener(
  "click",
  inspectTrades
);


els.loadOrderBookBtn?.addEventListener(
  "click",
  loadOrderBook
);


/* =========================================================
   INITIALIZE
========================================================= */

async function initialize() {

  state.exchange =
    new BinanceFuturesExchange(
      state.symbol
    );

  state.exchange.onTrade(
    handleTrade
  );

  state.exchange.onConnection(
    handleConnection
  );

  createOrderBookTotals();

  updateTradeTableHeaders();

  await changePair();

  setInterval(
    loadTicker,
    10000
  );

}


initialize();


/* =========================================================
   DEBUG ACCESS
========================================================= */

window.BinanceFuturesExchange =
  BinanceFuturesExchange;

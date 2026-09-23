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

      if (
        Number.isFinite(
          lastOpenTime
        ) &&
        lastOpenTime >= endTime
      ) {

        break;

      }

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

/*
 * PART 2 continues directly from here.
 *
 * Do NOT add another closing brace or
 * start a new JavaScript file between
 * Part 1 and Part 2.
 */function drawTradeFlowCanvas(
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

  /*
   * Disconnect the previous observer before
   * rebuilding the canvas. This prevents a new
   * ResizeObserver from being created every
   * time the chart is resized.
   */

  if (
    container._flowResizeObserver
  ) {

    try {

      container._flowResizeObserver.disconnect();

    } catch (
      error
    ) {

      console.warn(
        "Unable to disconnect previous chart observer:",
        error
      );

    }

    container._flowResizeObserver =
      null;

  }


  /*
   * Normalize the incoming series.
   *
   * This keeps the renderer tolerant of the
   * existing Futures kline structure.
   */

  const data =
    series
      .map(
        (
          candle,
          index
        ) => {

          const taker =
            Number(
              candle?.buyTaker
            );

          const maker =
            Number(
              candle?.buyMaker
            );

          let flow =
            Number(
              candle?.flow
            );

          const time =
            Number(
              candle?.time
            );

          return {

            time:
              Number.isFinite(
                time
              )
                ? time
                : index,

            taker:
              Number.isFinite(
                taker
              )
                ? taker
                : 0,

            maker:
              Number.isFinite(
                maker
              )
                ? maker
                : 0,

            flow:
              Number.isFinite(
                flow
              )
                ? flow
                : (
                    (
                      Number.isFinite(
                        taker
                      )
                        ? taker
                        : 0
                    ) -
                    (
                      Number.isFinite(
                        maker
                      )
                        ? maker
                        : 0
                    )
                  )

          };

        }
      )
      .filter(
        candle =>
          Number.isFinite(
            candle.time
          )
      );


  if (
    !data.length
  ) {

    return;

  }


  /*
   * Preserve zoom and crosshair state when
   * ResizeObserver redraws the chart.
   */

  const fullStart =
    data[0].time;

  const fullEnd =
    data[
      data.length - 1
    ].time;

  const fullSpan =
    Math.max(
      1,
      fullEnd -
      fullStart
    );


  let viewStart =
    Number(
      container._flowViewStart
    );

  let viewEnd =
    Number(
      container._flowViewEnd
    );


  if (
    !Number.isFinite(
      viewStart
    ) ||
    !Number.isFinite(
      viewEnd
    ) ||
    viewEnd <= viewStart
  ) {

    viewStart =
      fullStart;

    viewEnd =
      fullEnd;

  }


  viewStart =
    Math.max(
      fullStart,
      Math.min(
        viewStart,
        fullEnd
      )
    );

  viewEnd =
    Math.max(
      fullStart,
      Math.min(
        viewEnd,
        fullEnd
      )
    );


  if (
    viewEnd <= viewStart
  ) {

    viewStart =
      fullStart;

    viewEnd =
      fullEnd;

  }


  let crosshairIndex =
    Number.isInteger(
      container._flowCrosshairIndex
    )
      ? container._flowCrosshairIndex
      : -1;

  let crosshairPinned =
    container._flowCrosshairPinned ===
    true;


  /*
   * Rebuild chart DOM.
   */

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

  /*
   * Prevent the browser from treating
   * touch gestures as page scrolling.
   */

  canvas.style.touchAction =
    "none";

  canvas.style.cursor =
    "crosshair";


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
    Math.round(
      width *
      dpr
    );

  canvas.height =
    Math.round(
      height *
      dpr
    );


  const ctx =
    canvas.getContext(
      "2d"
    );


  if (
    !ctx
  ) {

    return;

  }


  ctx.setTransform(
    dpr,
    0,
    0,
    dpr,
    0,
    0
  );


  const padding = {

    left:
      78,

    right:
      22,

    top:
      46,

    bottom:
      58

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
   * Touch state used for pinch zoom.
   */

  let touchPoints =
    new Map();

  let pinchDistance =
    null;


  /*
   * Format displayed quantities.
   */

  function displayVolume(
    value
  ) {

    try {

      if (
        typeof formatVolume ===
        "function"
      ) {

        return formatVolume(
          value
        );

      }

    } catch (
      error
    ) {

      /*
       * Fall through to the
       * generic formatter.
       */

    }


    const number =
      Number(
        value
      );


    if (
      !Number.isFinite(
        number
      )
    ) {

      return "--";

    }


    return number.toLocaleString(
      undefined,
      {

        maximumFractionDigits:
          4

      }
    );

  }


  /*
   * Exact timestamp formatter.
   */

  function formatChartTime(
    timestamp
  ) {

    const date =
      new Date(
        timestamp
      );


    if (
      !Number.isFinite(
        date.getTime()
      )
    ) {

      return "Invalid time";

    }


    return date.toLocaleString(
      undefined,
      {

        year:
          "numeric",

        month:
          "2-digit",

        day:
          "2-digit",

        hour:
          "2-digit",

        minute:
          "2-digit",

        second:
          "2-digit"

      }
    );

  }


  function clamp(
    value,
    minimum,
    maximum
  ) {

    return Math.max(
      minimum,
      Math.min(
        maximum,
        value
      )
    );

  }


  /*
   * Find the first and last candle that
   * can influence the currently visible
   * section.
   */

  function getVisibleIndices() {

    let low =
      0;

    let high =
      data.length -
      1;


    while (
      low <
      high
    ) {

      const middle =
        Math.floor(
          (
            low +
            high
          ) /
          2
        );


      if (
        data[
          middle
        ].time <
        viewStart
      ) {

        low =
          middle +
          1;

      } else {

        high =
          middle;

      }

    }


    const first =
      Math.max(
        0,
        low -
        1
      );


    low =
      0;

    high =
      data.length -
      1;


    while (
      low <
      high
    ) {

      const middle =
        Math.ceil(
          (
            low +
            high
          ) /
          2
        );


      if (
        data[
          middle
        ].time <=
        viewEnd
      ) {

        low =
          middle;

      } else {

        high =
          middle -
          1;

      }

    }


    const last =
      Math.min(
        data.length -
          1,
        low +
          1
      );


    return [

      first,

      last

    ];

  }


  /*
   * Convert timestamp -> chart X.
   */

  function xForTime(
    timestamp
  ) {

    const span =
      Math.max(
        1,
        viewEnd -
        viewStart
      );


    return (
      padding.left +
      (
        (
          timestamp -
          viewStart
        ) /
        span
      ) *
      chartWidth
    );

  }


  /*
   * Convert chart X -> timestamp.
   */

  function timeForX(
    x
  ) {

    const span =
      Math.max(
        1,
        viewEnd -
        viewStart
      );


    const ratio =
      clamp(
        (
          x -
          padding.left
        ) /
        chartWidth,
        0,
        1
      );


    return (
      viewStart +
      ratio *
      span
    );

  }


  /*
   * Locate the nearest actual candle
   * to a timestamp.
   */

  function nearestIndex(
    timestamp
  ) {

    let low =
      0;

    let high =
      data.length -
      1;


    while (
      low <
      high
    ) {

      const middle =
        Math.floor(
          (
            low +
            high
          ) /
          2
        );


      if (
        data[
          middle
        ].time <
        timestamp
      ) {

        low =
          middle +
          1;

      } else {

        high =
          middle;

      }

    }


    if (
      low >
      0
    ) {

      const previousDistance =
        Math.abs(
          data[
            low -
            1
          ].time -
          timestamp
        );


      const currentDistance =
        Math.abs(
          data[
            low
          ].time -
          timestamp
        );


      if (
        previousDistance <
        currentDistance
      ) {

        return (
          low -
          1
        );

      }

    }


    return low;

  }


  /*
   * Dynamic Y scale.
   *
   * IMPORTANT:
   * This is calculated from the visible
   * candles only. Therefore, zooming into
   * a region expands the lines vertically
   * instead of merely magnifying the whole
   * original chart.
   */

  function calculateScale(
    first,
    last
  ) {

    const values =
      [];


    for (
      let index =
        first;

      index <=
      last;

      index++
    ) {

      const candle =
        data[
          index
        ];


      values.push(
        candle.taker
      );

      values.push(
        candle.maker
      );

      values.push(
        candle.flow
      );

    }


    let minimum =
      Math.min(
        ...values
      );


    let maximum =
      Math.max(
        ...values
      );


    if (
      !Number.isFinite(
        minimum
      )
    ) {

      minimum =
        -1;

    }


    if (
      !Number.isFinite(
        maximum
      )
    ) {

      maximum =
        1;

    }


    if (
      minimum ===
      maximum
    ) {

      const expansion =
        Math.abs(
          minimum
        ) > 0
          ? Math.abs(
              minimum
            ) *
            0.1
          : 1;


      minimum -=
        expansion;

      maximum +=
        expansion;

    }


    const range =
      maximum -
      minimum;


    const margin =
      range *
      0.08;


    return {

      min:
        minimum -
        margin,

      max:
        maximum +
        margin

    };

  }


  function yForValue(
    value,
    scale
  ) {

    const range =
      Math.max(
        1e-12,
        scale.max -
        scale.min
      );


    return (
      padding.top +
      (
        1 -
        (
          (
            value -
            scale.min
          ) /
          range
        )
      ) *
      chartHeight
    );

  }


  /*
   * Draw one series line.
   */

  function drawLine(
    first,
    last,
    field,
    scale
  ) {

    ctx.beginPath();


    let started =
      false;


    for (
      let index =
        first;

      index <=
      last;

      index++
    ) {

      const candle =
        data[
          index
        ];


      const value =
        Number(
          candle[
            field
          ]
        );


      const safeValue =
        Number.isFinite(
          value
        )
          ? value
          : 0;


      const x =
        xForTime(
          candle.time
        );


      const y =
        yForValue(
          safeValue,
          scale
        );


      if (
        !started
      ) {

        ctx.moveTo(
          x,
          y
        );

        started =
          true;

      } else {

        ctx.lineTo(
          x,
          y
        );

      }

    }


    if (
      started
    ) {

      ctx.stroke();

    }

  }


  /*
   * Main renderer.
   */

  function draw() {

    /*
     * Background.
     */

    const computedStyle =
      getComputedStyle(
        container
      );


    const containerBackground =
      computedStyle.backgroundColor;


    ctx.fillStyle =
      (
        containerBackground &&
        containerBackground !==
          "rgba(0, 0, 0, 0)"
      )
        ? containerBackground
        : "#0b0f14";


    ctx.fillRect(
      0,
      0,
      width,
      height
    );


    const visible =
      getVisibleIndices();


    const first =
      visible[0];


    const last =
      visible[1];


    const scale =
      calculateScale(
        first,
        last
      );


    /*
     * Horizontal grid.
     */

    ctx.font =
      "11px sans-serif";

    ctx.textAlign =
      "right";

    ctx.textBaseline =
      "middle";


    for (
      let index =
        0;

      index <=
      5;

      index++
    ) {

      const ratio =
        index /
        5;


      const y =
        padding.top +
        chartHeight *
        ratio;


      const value =
        scale.max -
        (
          scale.max -
          scale.min
        ) *
        ratio;


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
        displayVolume(
          value
        ),
        padding.left -
        8,
        y
      );

    }


    /*
     * Zero line.
     */

    if (
      scale.min <=
        0 &&
      scale.max >=
        0
    ) {

      const zeroY =
        yForValue(
          0,
          scale
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


    /*
     * Vertical time grid.
     */

    const span =
      Math.max(
        1,
        viewEnd -
        viewStart
      );


    const approximateTickWidth =
      105;


    const tickCount =
      Math.max(
        2,
        Math.min(
          10,
          Math.floor(
            chartWidth /
            approximateTickWidth
          )
        )
      );


    ctx.textAlign =
      "center";

    ctx.textBaseline =
      "top";


    for (
      let index =
        0;

      index <=
      tickCount;

      index++
    ) {

      const timestamp =
        viewStart +
        (
          span *
          index /
          tickCount
        );


      const x =
        xForTime(
          timestamp
        );


      ctx.beginPath();

      ctx.moveTo(
        x,
        padding.top
      );

      ctx.lineTo(
        x,
        height -
        padding.bottom
      );


      ctx.strokeStyle =
        "rgba(128,128,128,0.10)";

      ctx.lineWidth =
        1;

      ctx.stroke();


      const date =
        new Date(
          timestamp
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


      ctx.fillStyle =
        "rgba(128,128,128,0.90)";


      ctx.fillText(
        label,
        x,
        height -
        padding.bottom +
        12
      );

    }


    /*
     * Chart title.
     */

    ctx.textAlign =
      "left";

    ctx.textBaseline =
      "alphabetic";

    ctx.font =
      "bold 13px sans-serif";

    ctx.fillStyle =
      "rgba(230,235,240,0.95)";


    ctx.fillText(
      "Trade Flow",
      padding.left,
      20
    );


    /*
     * Legend.
     */

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
      34;


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
        legendX +
        18,
        legendY
      );


      ctx.strokeStyle =
        item.color;

      ctx.lineWidth =
        3;

      ctx.stroke();


      ctx.fillStyle =
        "rgba(128,128,128,0.95)";

      ctx.textAlign =
        "left";

      ctx.textBaseline =
        "middle";


      ctx.fillText(
        item.label,
        legendX +
        25,
        legendY
      );


      legendX +=
        25 +
        ctx.measureText(
          item.label
        ).width +
        25;

    }


    /*
     * Draw Buy Taker.
     */

    ctx.lineWidth =
      2;

    ctx.lineJoin =
      "round";

    ctx.lineCap =
      "round";

    ctx.strokeStyle =
      "#22c55e";


    drawLine(
      first,
      last,
      "taker",
      scale
    );


    /*
     * Draw Buy Maker.
     */

    ctx.strokeStyle =
      "#ef4444";


    drawLine(
      first,
      last,
      "maker",
      scale
    );


    /*
     * Draw Taker - Maker.
     */

    ctx.strokeStyle =
      "#3b82f6";

    ctx.lineWidth =
      2.5;


    drawLine(
      first,
      last,
      "flow",
      scale
    );


    /*
     * Crosshair.
     */

    if (
      crosshairIndex >= 0 &&
      crosshairIndex <
        data.length
    ) {

      const candle =
        data[
          crosshairIndex
        ];


      /*
       * Do not draw the crosshair if
       * the selected candle is completely
       * outside the visible range.
       */

      if (
        candle.time >=
          viewStart &&
        candle.time <=
          viewEnd
      ) {

        const x =
          xForTime(
            candle.time
          );


        /*
         * Use the average of the three
         * values to position the horizontal
         * guide.
         */

        const average =
          (
            candle.taker +
            candle.maker +
            candle.flow
          ) /
          3;


        const horizontalY =
          clamp(
            yForValue(
              average,
              scale
            ),
            padding.top,
            height -
              padding.bottom
          );


        /*
         * Vertical guide.
         */

        ctx.beginPath();

        ctx.moveTo(
          x,
          padding.top
        );

        ctx.lineTo(
          x,
          height -
          padding.bottom
        );


        ctx.strokeStyle =
          crosshairPinned
            ? "rgba(255,255,255,0.85)"
            : "rgba(255,255,255,0.45)";

        ctx.lineWidth =
          crosshairPinned
            ? 1.5
            : 1;


        ctx.setLineDash([
          5,
          5
        ]);


        ctx.stroke();


        /*
         * Horizontal guide.
         */

        ctx.beginPath();

        ctx.moveTo(
          padding.left,
          horizontalY
        );

        ctx.lineTo(
          width -
          padding.right,
          horizontalY
        );


        ctx.stroke();


        ctx.setLineDash([]);


        /*
         * Highlight each series at
         * the selected candle.
         */

        const points = [

          {

            value:
              candle.taker,

            color:
              "#22c55e"

          },

          {

            value:
              candle.maker,

            color:
              "#ef4444"

          },

          {

            value:
              candle.flow,

            color:
              "#3b82f6"

          }

        ];


        for (
          const point of points
        ) {

          const pointY =
            yForValue(
              point.value,
              scale
            );


          ctx.beginPath();

          ctx.arc(
            x,
            pointY,
            4,
            0,
            Math.PI *
              2
          );


          ctx.fillStyle =
            point.color;

          ctx.fill();


          ctx.beginPath();

          ctx.arc(
            x,
            pointY,
            6,
            0,
            Math.PI *
              2
          );


          ctx.strokeStyle =
            "rgba(255,255,255,0.75)";

          ctx.lineWidth =
            1;

          ctx.stroke();

        }


        /*
         * Information panel.
         */

        const boxWidth =
          Math.min(
            300,
            width -
              20
          );


        const boxHeight =
          82;


        const boxX =
          clamp(
            x +
              14,
            8,
            width -
              boxWidth -
              8
          );


        const boxY =
          clamp(
            horizontalY -
              boxHeight -
              14,
            8,
            height -
              boxHeight -
              8
          );


        ctx.beginPath();

        ctx.roundRect(
          boxX,
          boxY,
          boxWidth,
          boxHeight,
          7
        );


        ctx.fillStyle =
          "rgba(5,8,12,0.94)";

        ctx.fill();


        ctx.strokeStyle =
          "rgba(255,255,255,0.20)";

        ctx.lineWidth =
          1;

        ctx.stroke();


        ctx.textAlign =
          "left";

        ctx.textBaseline =
          "top";


        ctx.font =
          "bold 11px sans-serif";

        ctx.fillStyle =
          "#f2f5f8";


        ctx.fillText(
          formatChartTime(
            candle.time
          ),
          boxX +
            9,
          boxY +
            8
        );


        ctx.font =
          "11px sans-serif";


        ctx.fillStyle =
          "#22c55e";


        ctx.fillText(
          `Buy Taker: ${
            displayVolume(
              candle.taker
            )
          }`,
          boxX +
            9,
          boxY +
            27
        );


        ctx.fillStyle =
          "#ef4444";


        ctx.fillText(
          `Buy Maker: ${
            displayVolume(
              candle.maker
            )
          }`,
          boxX +
            9,
          boxY +
            42
        );


        ctx.fillStyle =
          "#3b82f6";


        ctx.fillText(
          `Taker - Maker: ${
            displayVolume(
              candle.flow
            )
          }`,
          boxX +
            9,
          boxY +
            57
        );

      }

    }


    /*
     * Bottom interaction instructions.
     */

    ctx.font =
      "11px sans-serif";

    ctx.textAlign =
      "left";

    ctx.textBaseline =
      "bottom";

    ctx.fillStyle =
      "rgba(128,128,128,0.75)";


    ctx.fillText(
      crosshairPinned
        ? "PINNED • click/tap another candle to move • double-click resets"
        : "Wheel/pinch = zoom • move = crosshair • click/tap = pin • double-click = reset",
      padding.left,
      height -
        6
    );

  }


  /*
   * Zoom around the exact location
   * under the mouse/fingers.
   *
   * factor < 1:
   * zoom in
   *
   * factor > 1:
   * zoom out
   */

  function zoomAt(
    clientX,
    factor
  ) {

    const bounds =
      canvas.getBoundingClientRect();


    const localX =
      clientX -
      bounds.left;


    const anchorTime =
      timeForX(
        localX
      );


    const currentSpan =
      Math.max(
        1,
        viewEnd -
        viewStart
      );


    /*
     * Do not allow the user to zoom
     * into a single timestamp.
     */

    const minimumSpan =
      Math.max(
        1,
        fullSpan /
        Math.max(
          100,
          data.length *
            4
        )
      );


    const maximumSpan =
      fullSpan;


    let newSpan =
      currentSpan *
      factor;


    newSpan =
      clamp(
        newSpan,
        minimumSpan,
        maximumSpan
      );


    const anchorRatio =
      clamp(
        (
          anchorTime -
          viewStart
        ) /
        currentSpan,
        0,
        1
      );


    let newStart =
      anchorTime -
      newSpan *
      anchorRatio;


    let newEnd =
      newStart +
      newSpan;


    /*
     * Keep the visible window inside
     * the complete historical series.
     */

    if (
      newStart <
      fullStart
    ) {

      newStart =
        fullStart;

      newEnd =
        newStart +
        newSpan;

    }


    if (
      newEnd >
      fullEnd
    ) {

      newEnd =
        fullEnd;

      newStart =
        newEnd -
        newSpan;

    }


    if (
      newStart <
      fullStart
    ) {

      newStart =
        fullStart;

    }


    viewStart =
      newStart;

    viewEnd =
      newEnd;


    if (
      newSpan >=
      fullSpan
    ) {

      viewStart =
        fullStart;

      viewEnd =
        fullEnd;

    }


    container._flowViewStart =
      viewStart;

    container._flowViewEnd =
      viewEnd;


    draw();

  }


  /*
   * Mouse-wheel zoom.
   *
   * This is chart-local. The browser page
   * itself does not zoom.
   */

  canvas.addEventListener(
    "wheel",
    event => {

      event.preventDefault();


      const zoomFactor =
        event.deltaY > 0
          ? 1.22
          : 0.82;


      zoomAt(
        event.clientX,
        zoomFactor
      );

    },
    {
      passive:
        false
    }
  );


  /*
   * Desktop crosshair movement.
   */

  canvas.addEventListener(
    "pointermove",
    event => {

      if (
        event.pointerType ===
        "touch"
      ) {

        return;

      }


      const bounds =
        canvas.getBoundingClientRect();


      const localX =
        event.clientX -
        bounds.left;


      /*
       * Only activate the crosshair
       * inside the actual plotting area.
       */

      if (
        localX <
          padding.left ||
        localX >
          width -
            padding.right
      ) {

        if (
          !crosshairPinned
        ) {

          crosshairIndex =
            -1;

          container._flowCrosshairIndex =
            -1;

          draw();

        }

        return;

      }


      const timestamp =
        timeForX(
          localX
        );


      crosshairIndex =
        nearestIndex(
          timestamp
        );


      container._flowCrosshairIndex =
        crosshairIndex;


      draw();

    }
  );


  /*
   * Desktop click:
   *
   * click once:
   * pin crosshair
   *
   * click again:
   * unpin
   *
   * Clicking another candle while pinned
   * moves the pin to that candle.
   */

  canvas.addEventListener(
    "pointerdown",
    event => {

      if (
        event.pointerType ===
        "touch"
      ) {

        canvas.setPointerCapture?.(
          event.pointerId
        );


        touchPoints.set(
          event.pointerId,
          {

            x:
              event.clientX,

            y:
              event.clientY

          }
        );


        if (
          touchPoints.size ===
          2
        ) {

          const points =
            Array.from(
              touchPoints.values()
            );


          pinchDistance =
            Math.hypot(
              points[0].x -
                points[1].x,
              points[0].y -
                points[1].y
            );

        }


        return;

      }


      const bounds =
        canvas.getBoundingClientRect();


      const localX =
        event.clientX -
        bounds.left;


      if (
        localX <
          padding.left ||
        localX >
          width -
            padding.right
      ) {

        return;

      }


      crosshairIndex =
        nearestIndex(
          timeForX(
            localX
          )
        );


      crosshairPinned =
        !crosshairPinned;


      container._flowCrosshairIndex =
        crosshairIndex;

      container._flowCrosshairPinned =
        crosshairPinned;


      draw();

    }
  );


  /*
   * Mobile pinch zoom.
   */

  canvas.addEventListener(
    "pointermove",
    event => {

      if (
        event.pointerType !==
        "touch"
      ) {

        return;

      }


      touchPoints.set(
        event.pointerId,
        {

          x:
            event.clientX,

          y:
            event.clientY

        }
      );


      if (
        touchPoints.size !==
        2
      ) {

        return;

      }


      const points =
        Array.from(
          touchPoints.values()
        );


      const currentDistance =
        Math.hypot(
          points[0].x -
            points[1].x,
          points[0].y -
            points[1].y
        );


      if (
        !pinchDistance ||
        pinchDistance <= 0
      ) {

        pinchDistance =
          currentDistance;

        return;

      }


      const zoomFactor =
        pinchDistance /
        Math.max(
          1,
          currentDistance
        );


      /*
       * Prevent tiny finger movements
       * from causing excessive redraws.
       */

      if (
        Math.abs(
          zoomFactor -
          1
        ) >
        0.002
      ) {

        zoomAt(
          (
            points[0].x +
            points[1].x
          ) /
          2,
          zoomFactor
        );

        pinchDistance =
          currentDistance;

      }

    }
  );


  function handleTouchEnd(
    event
  ) {

    touchPoints.delete(
      event.pointerId
    );


    if (
      touchPoints.size <
      2
    ) {

      pinchDistance =
        null;

    }

  }


  canvas.addEventListener(
    "pointerup",
    handleTouchEnd
  );


  canvas.addEventListener(
    "pointercancel",
    handleTouchEnd
  );


  /*
   * Mobile tap:
   * select and pin a candle.
   */

  canvas.addEventListener(
    "click",
    event => {

      /*
       * Desktop clicks are already
       * handled by pointerdown.
       */

      if (
        event.pointerType !==
        "touch"
      ) {

        return;

      }


      const bounds =
        canvas.getBoundingClientRect();


      const localX =
        event.clientX -
        bounds.left;


      if (
        localX <
          padding.left ||
        localX >
          width -
            padding.right
      ) {

        return;

      }


      crosshairIndex =
        nearestIndex(
          timeForX(
            localX
          )
        );


      crosshairPinned =
        true;


      container._flowCrosshairIndex =
        crosshairIndex;

      container._flowCrosshairPinned =
        true;


      draw();

    }
  );


  /*
   * Double-click:
   * restore the complete historical
   * time range and clear the crosshair.
   */

  canvas.addEventListener(
    "dblclick",
    event => {

      event.preventDefault();


      viewStart =
        fullStart;

      viewEnd =
        fullEnd;


      crosshairIndex =
        -1;

      crosshairPinned =
        false;


      container._flowViewStart =
        viewStart;

      container._flowViewEnd =
        viewEnd;

      container._flowCrosshairIndex =
        -1;

      container._flowCrosshairPinned =
        false;


      draw();

    }
  );


  /*
   * Save current chart state.
   */

  container._flowViewStart =
    viewStart;

  container._flowViewEnd =
    viewEnd;

  container._flowCrosshairIndex =
    crosshairIndex;

  container._flowCrosshairPinned =
    crosshairPinned;


  /*
   * ResizeObserver redraws the chart
   * without fetching historical data again.
   */

  if (
    typeof ResizeObserver !==
    "undefined"
  ) {

    const resizeObserver =
      new ResizeObserver(
        () => {

          drawTradeFlowCanvas(
            container,
            series
          );

        }
      );


    container._flowResizeObserver =
      resizeObserver;


    resizeObserver.observe(
      container
    );

  }


  /*
   * Initial render.
   */

  draw();

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
      ${String(message || "Unable to load chart data.")}
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
        Number(levels) || 10
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

    chart._flowViewStart =
      null;

    chart._flowViewEnd =
      null;

    chart._flowCrosshairIndex =
      null;

    chart._flowCrosshairPinned =
      false;

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

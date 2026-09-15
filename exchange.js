"use strict";

/*
 * ALPHA TRACKER
 * Binance USDⓈ-M Futures Exchange Layer
 *
 * Responsibilities:
 * - Binance USDⓈ-M Futures public market data
 * - Futures symbol discovery
 * - Real-time aggregate trades
 * - Futures order-book snapshots
 * - Futures 24h ticker
 * - Futures aggregate-trade normalization
 * - Safe WebSocket reconnects
 */


/* =========================================================
   BINANCE USDⓈ-M FUTURES ENDPOINTS
   ========================================================= */

const BINANCE_REST =
  "https://fapi.binance.com/fapi/v1";

const BINANCE_WS =
  "wss://fstream.binance.com/ws";


/* =========================================================
   EXCHANGE CLIENT
   ========================================================= */

class BinanceExchange {

  constructor(symbol = null) {

    this.symbol = null;

    this.tradeSocket = null;

    this.tradeListeners = [];

    this.connectionListeners = [];

    this.reconnectTimer = null;

    this.reconnectAttempts = 0;

    this.maxReconnectDelay = 10000;

    this.connected = false;

    this.intentionalDisconnect = false;

    /*
     * Futures symbol cache.
     */
    this.symbolCache = null;

    this.symbolCacheTime = 0;

    this.symbolCacheTTL =
      5 * 60 * 1000;

    if (symbol) {
      this.setSymbol(symbol);
    }
  }


  /* =======================================================
     SYMBOL
     ======================================================= */

  setSymbol(symbol) {

    const normalized =
      String(symbol || "")
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "");

    if (!normalized) {
      throw new Error(
        "Invalid Futures symbol"
      );
    }

    this.symbol = normalized;
  }


  getSymbol() {

    return this.symbol;
  }


  /* =======================================================
     REST REQUEST
     ======================================================= */

  async request(endpoint) {

    const response =
      await fetch(
        `${BINANCE_REST}${endpoint}`,
        {
          method: "GET",
          cache: "no-store"
        }
      );

    if (!response.ok) {

      let message =
        `Binance Futures HTTP ${response.status}`;

      try {

        const error =
          await response.json();

        if (error && error.msg) {
          message = error.msg;
        }

      } catch (_) {
        // Keep default message.
      }

      throw new Error(message);
    }

    return response.json();
  }


  /* =======================================================
     FUTURES EXCHANGE INFO
     ======================================================= */

  async getExchangeInfo() {

    return this.request(
      "/exchangeInfo"
    );
  }


  /* =======================================================
     FUTURES SYMBOL LIST
     ======================================================= */

  async getFuturesSymbols(
    forceRefresh = false
  ) {

    const now =
      Date.now();

    if (
      !forceRefresh &&
      this.symbolCache &&
      now - this.symbolCacheTime <
        this.symbolCacheTTL
    ) {
      return this.symbolCache;
    }

    const info =
      await this.getExchangeInfo();

    if (
      !info ||
      !Array.isArray(info.symbols)
    ) {
      return [];
    }

    this.symbolCache =
      info.symbols
        .filter(symbol => {

          return (
            symbol &&
            symbol.status === "TRADING" &&
            symbol.contractType ===
              "PERPETUAL" &&
            symbol.quoteAsset === "USDT"
          );

        })
        .map(symbol => {

          return {
            symbol:
              symbol.symbol,

            baseAsset:
              symbol.baseAsset,

            quoteAsset:
              symbol.quoteAsset,

            contractType:
              symbol.contractType,

            status:
              symbol.status,

            pricePrecision:
              symbol.pricePrecision,

            quantityPrecision:
              symbol.quantityPrecision,

            tickSize:
              this.getFilterValue(
                symbol.filters,
                "PRICE_FILTER",
                "tickSize"
              ),

            stepSize:
              this.getFilterValue(
                symbol.filters,
                "LOT_SIZE",
                "stepSize"
              )
          };

        });

    this.symbolCacheTime =
      now;

    return this.symbolCache;
  }


  /* =======================================================
     FILTER HELPER
     ======================================================= */

  getFilterValue(
    filters,
    filterType,
    field
  ) {

    if (
      !Array.isArray(filters)
    ) {
      return null;
    }

    const filter =
      filters.find(
        item =>
          item &&
          item.filterType ===
            filterType
      );

    if (!filter) {
      return null;
    }

    return filter[field] ??
      null;
  }


  /* =======================================================
     RESOLVE FUTURES SYMBOL
     =======================================================

     Accepts:

       BTC
       BTCUSDT
       BTC/USDT

     And resolves to:

       BTCUSDT

     Only active USDT perpetual
     Futures contracts are accepted.
     */

  async resolveSymbol(query) {

    const normalized =
      String(query || "")
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "");

    if (!normalized) {
      throw new Error(
        "Enter a Futures pair"
      );
    }

    const symbols =
      await this.getFuturesSymbols();

    /*
     * Exact symbol match.
     */

    const exact =
      symbols.find(
        item =>
          item.symbol ===
          normalized
      );

    if (exact) {
      return exact.symbol;
    }

    /*
     * User entered base asset only.
     *
     * Example:
     *
     * TA
     * CLANKER
     *
     * becomes:
     *
     * TAUSDT
     * CLANKERUSDT
     */

    const baseMatch =
      symbols.find(
        item =>
          item.baseAsset ===
          normalized
      );

    if (baseMatch) {
      return baseMatch.symbol;
    }

    /*
     * Prefix match as a convenience.
     */

    const prefixMatch =
      symbols.find(
        item =>
          item.symbol.startsWith(
            normalized
          )
      );

    if (prefixMatch) {
      return prefixMatch.symbol;
    }

    throw new Error(
      `${normalized} is not an active Binance USDⓈ-M Futures pair`
    );
  }


  /* =======================================================
     24H FUTURES TICKER
     ======================================================= */

  async get24hTicker(
    symbol = this.symbol
  ) {

    if (!symbol) {
      throw new Error(
        "No Futures symbol selected"
      );
    }

    const normalized =
      String(symbol)
        .trim()
        .toUpperCase();

    return this.request(
      `/ticker/24hr?symbol=${encodeURIComponent(
        normalized
      )}`
    );
  }


  /* =======================================================
     FUTURES ORDER BOOK
     ======================================================= */

  async getOrderBook(
    symbol = this.symbol,
    limit = 100
  ) {

    if (!symbol) {
      throw new Error(
        "No Futures symbol selected"
      );
    }

    const normalized =
      String(symbol)
        .trim()
        .toUpperCase();

    const safeLimit =
      Math.min(
        Math.max(
          Number(limit) || 100,
          5
        ),
        1000
      );

    const raw =
      await this.request(
        `/depth?symbol=${encodeURIComponent(
          normalized
        )}&limit=${safeLimit}`
      );

    return {

      lastUpdateId:
        raw.lastUpdateId,

      bids:
        Array.isArray(raw.bids)
          ? raw.bids.map(level => ({
              price:
                Number(level[0]),

              quantity:
                Number(level[1])
            }))
          : [],

      asks:
        Array.isArray(raw.asks)
          ? raw.asks.map(level => ({
              price:
                Number(level[0]),

              quantity:
                Number(level[1])
            }))
          : []
    };
  }


  /* =======================================================
     FUTURES RECENT AGGREGATE TRADES
     ======================================================= */

  async getRecentTrades(
    symbol = this.symbol,
    limit = 1000
  ) {

    if (!symbol) {
      throw new Error(
        "No Futures symbol selected"
      );
    }

    const normalized =
      String(symbol)
        .trim()
        .toUpperCase();

    const safeLimit =
      Math.min(
        Math.max(
          Number(limit) || 1000,
          1
        ),
        1000
      );

    const raw =
      await this.request(
        `/aggTrades?symbol=${encodeURIComponent(
          normalized
        )}&limit=${safeLimit}`
      );

    if (!Array.isArray(raw)) {
      return [];
    }

    return raw
      .map(
        trade =>
          this.normalizeAggregateTrade(
            trade
          )
      )
      .filter(Boolean);
  }


  /* =======================================================
     FUTURES HISTORICAL AGGREGATE TRADES
     ======================================================= */

  async getHistoricalTrades(
    symbol = this.symbol,
    startTime,
    endTime,
    limit = 1000
  ) {

    if (!symbol) {
      throw new Error(
        "No Futures symbol selected"
      );
    }

    if (
      !Number.isFinite(
        Number(startTime)
      ) ||
      !Number.isFinite(
        Number(endTime)
      )
    ) {
      throw new Error(
        "Invalid historical trade time range"
      );
    }

    const normalized =
      String(symbol)
        .trim()
        .toUpperCase();

    const safeLimit =
      Math.min(
        Math.max(
          Number(limit) || 1000,
          1
        ),
        1000
      );

    const params =
      new URLSearchParams();

    params.set(
      "symbol",
      normalized
    );

    params.set(
      "startTime",
      String(
        Math.floor(
          Number(startTime)
        )
      )
    );

    params.set(
      "endTime",
      String(
        Math.floor(
          Number(endTime)
        )
      )
    );

    params.set(
      "limit",
      String(safeLimit)
    );

    const raw =
      await this.request(
        `/aggTrades?${params.toString()}`
      );

    if (!Array.isArray(raw)) {
      return [];
    }

    return raw
      .map(
        trade =>
          this.normalizeAggregateTrade(
            trade
          )
      )
      .filter(Boolean);
  }


  /* =======================================================
     NORMALIZE AGGREGATE TRADE
     ======================================================= */

  normalizeAggregateTrade(trade) {

    if (!trade) {
      return null;
    }

    const price =
      Number(trade.p);

    const quantity =
      Number(trade.q);

    const time =
      Number(trade.T);

    const buyerIsMaker =
      trade.m === true ||
      trade.m === "true";

    if (
      !Number.isFinite(price) ||
      !Number.isFinite(quantity) ||
      quantity <= 0
    ) {
      return null;
    }

    return {

      id:
        Number(trade.a),

      time,

      price,

      quantity,

      value:
        price * quantity,

      buyerIsMaker,

      /*
       * Binance Futures aggTrade:
       *
       * m = true
       * buyer is maker
       * seller is taker
       *
       * m = false
       * seller is maker
       * buyer is taker
       */

      aggressiveSide:
        buyerIsMaker
          ? "sell"
          : "buy",

      aggressiveBuy:
        buyerIsMaker
          ? 0
          : quantity,

      aggressiveSell:
        buyerIsMaker
          ? quantity
          : 0
    };
  }


  /* =======================================================
     TRADE LISTENERS
     ======================================================= */

  onTrade(callback) {

    if (
      typeof callback !==
      "function"
    ) {
      return;
    }

    this.tradeListeners.push(
      callback
    );
  }


  removeTradeListener(callback) {

    this.tradeListeners =
      this.tradeListeners.filter(
        listener =>
          listener !== callback
      );
  }


  emitTrade(trade) {

    if (!trade) {
      return;
    }

    for (
      const listener of
      this.tradeListeners
    ) {

      try {

        listener(trade);

      } catch (error) {

        console.error(
          "Trade listener error:",
          error
        );

      }
    }
  }


  /* =======================================================
     CONNECTION LISTENERS
     ======================================================= */

  onConnection(callback) {

    if (
      typeof callback !==
      "function"
    ) {
      return;
    }

    this.connectionListeners.push(
      callback
    );
  }


  onConnectionChange(callback) {

    this.onConnection(callback);
  }


  removeConnectionListener(callback) {

    this.connectionListeners =
      this.connectionListeners.filter(
        listener =>
          listener !== callback
      );
  }


  emitConnection(status) {

    this.connected =
      status === "connected";

    for (
      const listener of
      this.connectionListeners
    ) {

      try {

        listener(status);

      } catch (error) {

        console.error(
          "Connection listener error:",
          error
        );

      }
    }
  }


  /* =======================================================
     FUTURES AGGREGATE TRADE WEBSOCKET
     ======================================================= */

  connectTradeStream(
    symbol = this.symbol
  ) {

    if (!symbol) {
      throw new Error(
        "No Futures symbol selected"
      );
    }

    const normalized =
      String(symbol)
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "");

    if (!normalized) {
      throw new Error(
        "Invalid Futures symbol"
      );
    }

    if (this.reconnectTimer) {

      clearTimeout(
        this.reconnectTimer
      );

      this.reconnectTimer =
        null;
    }

    if (this.tradeSocket) {

      this.intentionalDisconnect =
        true;

      try {
        this.tradeSocket.close();
      } catch (_) {
        // Ignore closed socket.
      }

      this.tradeSocket =
        null;
    }

    this.setSymbol(
      normalized
    );

    this.intentionalDisconnect =
      false;

    const streamSymbol =
      this.symbol.toLowerCase();

    const url =
      `${BINANCE_WS}/${streamSymbol}@aggTrade`;

    console.log(
      `Connecting Binance Futures trade stream: ${url}`
    );

    try {

      const socket =
        new WebSocket(url);

      this.tradeSocket =
        socket;

      socket.onopen =
        () => {

          if (
            this.tradeSocket !== socket
          ) {
            return;
          }

          console.log(
            `Binance Futures trade stream connected: ${this.symbol}`
          );

          this.reconnectAttempts =
            0;

          this.emitConnection(
            "connected"
          );
        };


      socket.onmessage =
        event => {

          if (
            this.tradeSocket !== socket
          ) {
            return;
          }

          try {

            const raw =
              JSON.parse(event.data);

            const trade =
              this.normalizeAggregateTrade(
                raw
              );

            this.emitTrade(
              trade
            );

          } catch (error) {

            console.error(
              "Futures trade message error:",
              error
            );

          }
        };


      socket.onerror =
        error => {

          if (
            this.tradeSocket !== socket
          ) {
            return;
          }

          console.error(
            "Futures Trade WebSocket error:",
            error
          );

          this.emitConnection(
            "error"
          );
        };


      socket.onclose =
        () => {

          if (
            this.tradeSocket !== socket
          ) {
            return;
          }

          this.tradeSocket =
            null;

          console.log(
            `Futures trade stream closed: ${this.symbol}`
          );

          this.emitConnection(
            "disconnected"
          );

          if (
            !this.intentionalDisconnect &&
            this.symbol
          ) {

            this.scheduleReconnect();
          }
        };

    } catch (error) {

      console.error(
        "Futures WebSocket creation failed:",
        error
      );

      this.emitConnection(
        "error"
      );

      this.scheduleReconnect();
    }
  }


  /* =======================================================
     RECONNECT
     ======================================================= */

  scheduleReconnect() {

    if (
      this.reconnectTimer ||
      !this.symbol
    ) {
      return;
    }

    const delay =
      Math.min(
        1000 *
          Math.pow(
            2,
            this.reconnectAttempts
          ),
        this.maxReconnectDelay
      );

    this.reconnectAttempts++;

    console.log(
      `Reconnecting Futures trade stream in ${delay}ms`
    );

    this.reconnectTimer =
      setTimeout(
        () => {

          this.reconnectTimer =
            null;

          if (this.symbol) {

            this.connectTradeStream(
              this.symbol
            );
          }

        },
        delay
      );
  }


  /* =======================================================
     DISCONNECT
     ======================================================= */

  disconnectTradeStream(
    allowReconnect = false
  ) {

    if (this.reconnectTimer) {

      clearTimeout(
        this.reconnectTimer
      );

      this.reconnectTimer =
        null;
    }

    const socket =
      this.tradeSocket;

    this.intentionalDisconnect =
      true;

    this.tradeSocket =
      null;

    if (socket) {

      try {
        socket.close();
      } catch (_) {
        // Ignore closed socket.
      }
    }

    this.connected =
      false;

    if (allowReconnect) {

      this.intentionalDisconnect =
        false;

      if (this.symbol) {
        this.scheduleReconnect();
      }
    }
  }


  /* =======================================================
     CHANGE SYMBOL
     ======================================================= */

  changeSymbol(symbol) {

    const normalized =
      String(symbol || "")
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "");

    if (!normalized) {
      throw new Error(
        "Invalid Futures symbol"
      );
    }

    this.disconnectTradeStream(
      false
    );

    this.setSymbol(
      normalized
    );

    this.connectTradeStream(
      normalized
    );
  }
}


/* =========================================================
   GLOBAL EXPORT
   ========================================================= */

window.BinanceExchange =
  BinanceExchange;

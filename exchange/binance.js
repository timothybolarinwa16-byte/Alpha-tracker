"use strict";

/*
 * ALPHA TRACKER
 * Binance Exchange Layer
 *
 * Responsibilities:
 * - Connect to Binance public market endpoints
 * - Subscribe to real-time aggregate trades
 * - Normalize Binance trade data into Alpha Tracker format
 * - Provide order-book snapshots
 *
 * This file contains NO trading logic.
 * It only fetches and normalizes exchange data.
 */


/* =========================================================
   BINANCE ENDPOINTS
   ========================================================= */

const BINANCE_REST =
  "https://api.binance.com/api/v3";

const BINANCE_WS =
  "wss://stream.binance.com:9443/ws";


/* =========================================================
   EXCHANGE CLIENT
   ========================================================= */

class BinanceExchange {

  constructor() {

    this.symbol = null;

    this.tradeSocket = null;

    this.tradeListeners = [];

    this.connectionListeners = [];

    this.reconnectTimer = null;

    this.reconnectAttempts = 0;

    this.maxReconnectDelay = 10000;

    this.connected = false;
  }


  /* =======================================================
     SYMBOL
     ======================================================= */

  setSymbol(symbol) {

    const normalized =
      String(symbol || "")
        .trim()
        .toUpperCase()
        .replace(/\s+/g, "");

    if (!normalized) {
      throw new Error("Invalid symbol");
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
        `Binance HTTP ${response.status}`;

      try {

        const error =
          await response.json();

        if (error.msg) {
          message = error.msg;
        }

      } catch (_) {
        // Keep default error.
      }

      throw new Error(message);
    }


    return response.json();
  }


  /* =======================================================
     24H TICKER
     ======================================================= */

  async get24hTicker(symbol = this.symbol) {

    if (!symbol) {
      throw new Error("No symbol selected");
    }

    const normalized =
      String(symbol).toUpperCase();

    return this.request(
      `/ticker/24hr?symbol=${encodeURIComponent(normalized)}`
    );
  }


  /* =======================================================
     ORDER BOOK SNAPSHOT
     ======================================================= */

  async getOrderBook(
    symbol = this.symbol,
    limit = 100
  ) {

    if (!symbol) {
      throw new Error("No symbol selected");
    }


    const normalized =
      String(symbol).toUpperCase();


    const safeLimit =
      Math.min(
        Math.max(Number(limit) || 100, 5),
        5000
      );


    const raw =
      await this.request(
        `/depth?symbol=${encodeURIComponent(normalized)}&limit=${safeLimit}`
      );


    return {
      lastUpdateId: raw.lastUpdateId,

      bids: raw.bids.map(level => ({
        price: Number(level[0]),
        quantity: Number(level[1])
      })),

      asks: raw.asks.map(level => ({
        price: Number(level[0]),
        quantity: Number(level[1])
      }))
    };
  }


  /* =======================================================
     RECENT AGGREGATE TRADES
     ======================================================= */

  async getRecentTrades(
    symbol = this.symbol,
    limit = 1000
  ) {

    if (!symbol) {
      throw new Error("No symbol selected");
    }


    const normalized =
      String(symbol).toUpperCase();


    const safeLimit =
      Math.min(
        Math.max(Number(limit) || 1000, 1),
        1000
      );


    const raw =
      await this.request(
        `/aggTrades?symbol=${encodeURIComponent(normalized)}&limit=${safeLimit}`
      );


    return raw.map(
      trade => this.normalizeAggregateTrade(trade)
    );
  }


  /* =======================================================
     NORMALIZE AGGREGATE TRADE
     ======================================================= */

  normalizeAggregateTrade(trade) {

    /*
     * Binance aggregate trade fields:
     *
     * a = aggregate trade ID
     * p = price
     * q = quantity
     * f = first trade ID
     * l = last trade ID
     * T = timestamp
     * m = whether buyer is the market maker
     *
     * m === true:
     * buyer is maker
     * therefore seller is aggressive/taker
     *
     * m === false:
     * seller is maker
     * therefore buyer is aggressive/taker
     */


    const price =
      Number(trade.p);

    const quantity =
      Number(trade.q);

    const time =
      Number(trade.T);

    const buyerIsMaker =
      Boolean(trade.m);


    return {

      id: Number(trade.a),

      time,

      price,

      quantity,

      value: price * quantity,

      buyerIsMaker,

      /*
       * These fields describe the aggressive side.
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

    if (typeof callback !== "function") {
      return;
    }

    this.tradeListeners.push(callback);
  }


  removeTradeListener(callback) {

    this.tradeListeners =
      this.tradeListeners.filter(
        listener => listener !== callback
      );
  }


  emitTrade(trade) {

    for (
      const listener of this.tradeListeners
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

  onConnectionChange(callback) {

    if (typeof callback !== "function") {
      return;
    }

    this.connectionListeners.push(callback);
  }


  emitConnection(status) {

    this.connected =
      status === "connected";


    for (
      const listener of this.connectionListeners
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
     AGGREGATE TRADE WEBSOCKET
     ======================================================= */

  connectTradeStream(symbol = this.symbol) {

    if (!symbol) {
      throw new Error("No symbol selected");
    }


    this.setSymbol(symbol);


    this.disconnectTradeStream(false);


    const streamSymbol =
      this.symbol.toLowerCase();


    const url =
      `${BINANCE_WS}/${streamSymbol}@aggTrade`;


    console.log(
      `Connecting trade stream: ${url}`
    );


    try {

      this.tradeSocket =
        new WebSocket(url);

    } catch (error) {

      console.error(
        "WebSocket creation failed:",
        error
      );

      this.scheduleReconnect();

      return;
    }


    this.tradeSocket.onopen =
      () => {

        console.log(
          `Trade stream connected: ${this.symbol}`
        );


        this.reconnectAttempts = 0;

        this.emitConnection("connected");
      };


    this.tradeSocket.onmessage =
      event => {

        try {

          const raw =
            JSON.parse(event.data);


          const trade =
            this.normalizeAggregateTrade(raw);


          this.emitTrade(trade);

        } catch (error) {

          console.error(
            "Trade message error:",
            error
          );

        }
      };


    this.tradeSocket.onerror =
      error => {

        console.error(
          "Trade WebSocket error:",
          error
        );

        this.emitConnection("error");
      };


    this.tradeSocket.onclose =
      () => {

        console.log(
          `Trade stream closed: ${this.symbol}`
        );


        this.emitConnection("disconnected");


        /*
         * Reconnect automatically unless the
         * application intentionally changed pair.
         */

        if (this.symbol) {
          this.scheduleReconnect();
        }
      };
  }


  /* =======================================================
     RECONNECT
     ======================================================= */

  scheduleReconnect() {

    if (this.reconnectTimer) {
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
      `Reconnecting trade stream in ${delay}ms`
    );


    this.reconnectTimer =
      setTimeout(
        () => {

          this.reconnectTimer = null;

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

      this.reconnectTimer = null;
    }


    if (this.tradeSocket) {

      /*
       * Clear symbol temporarily so the
       * onclose handler does not reconnect
       * during an intentional disconnect.
       */

      const oldSymbol =
        this.symbol;


      if (!allowReconnect) {
        this.symbol = null;
      }


      try {
        this.tradeSocket.close();
      } catch (_) {
        // Socket may already be closed.
      }


      this.tradeSocket = null;


      if (!allowReconnect) {
        this.symbol = oldSymbol;
      }
    }


    this.connected = false;
  }


  /* =======================================================
     CHANGE SYMBOL
     ======================================================= */

  changeSymbol(symbol) {

    const normalized =
      String(symbol || "")
        .trim()
        .toUpperCase();


    if (!normalized) {
      throw new Error("Invalid symbol");
    }


    this.disconnectTradeStream(false);

    this.setSymbol(normalized);

    this.connectTradeStream(normalized);
  }
}


/* =========================================================
   GLOBAL EXPORT
   ========================================================= */

window.BinanceExchange =
  BinanceExchange;

const REST_BASE = "https://fapi.binance.com/fapi/v1";

function normalizeSymbol(symbol) {
  return String(symbol || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

async function requestJson(url) {
  const response = await fetch(url);

  if (!response.ok) {
    let message = `HTTP ${response.status}`;

    try {
      const error = await response.json();

      if (error?.msg) {
        message = error.msg;
      }
    } catch (_) {
      // Keep the HTTP status message.
    }

    throw new Error(message);
  }

  return response.json();
}

async function resolveSymbol(symbol) {
  const normalized = normalizeSymbol(symbol);

  if (!normalized) {
    throw new Error("Enter a trading pair.");
  }

  const url = `${REST_BASE}/exchangeInfo`;
  const data = await requestJson(url);

  const match = data.symbols?.find(
    item =>
      item.symbol === normalized &&
      item.status === "TRADING" &&
      item.contractType === "PERPETUAL"
  );

  if (!match) {
    throw new Error(`${normalized} is not an active USDⓈ-M perpetual.`);
  }

  return match.symbol;
}

async function get24hTicker(symbol) {
  const normalized = normalizeSymbol(symbol);

  const url =
    `${REST_BASE}/ticker/24hr?symbol=${encodeURIComponent(normalized)}`;

  const data = await requestJson(url);

  return {
    symbol: data.symbol,
    price: Number(data.lastPrice),
    priceChange: Number(data.priceChangePercent),
    volume: Number(data.volume),
    trades: Number(data.count)
  };
}

function getKlineIntervalMilliseconds(interval) {
  const match = String(interval).match(/^(\d+)([smhdwM])$/);

  if (!match) {
    throw new Error(`Unsupported interval: ${interval}`);
  }

  const amount = Number(match[1]);
  const unit = match[2];

  const unitMs = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
    M: 30 * 24 * 60 * 60 * 1000
  };

  return amount * unitMs[unit];
}

async function getHistoricalKlines(
  symbol,
  startTime,
  endTime,
  interval = "5m"
) {
  const normalized = normalizeSymbol(symbol);

  const intervalMs = getKlineIntervalMilliseconds(interval);

  const maxLimit = 1000;
  const candles = [];

  let cursor = Number(startTime);
  const finalTime = Number(endTime);

  if (!Number.isFinite(cursor) || !Number.isFinite(finalTime)) {
    throw new Error("Invalid analysis time range.");
  }

  if (cursor >= finalTime) {
    throw new Error("Start time must be before end time.");
  }

  let requestCount = 0;
  const maxRequests = 150;

  while (cursor < finalTime && requestCount < maxRequests) {
    const url =
      `${REST_BASE}/klines` +
      `?symbol=${encodeURIComponent(normalized)}` +
      `&interval=${encodeURIComponent(interval)}` +
      `&startTime=${cursor}` +
      `&endTime=${finalTime}` +
      `&limit=${maxLimit}`;

    const rows = await requestJson(url);

    requestCount += 1;

    if (!Array.isArray(rows) || rows.length === 0) {
      break;
    }

    for (const raw of rows) {
      if (!Array.isArray(raw) || raw.length < 10) {
        continue;
      }

      const openTime = Number(raw[0]);

      if (
        !Number.isFinite(openTime) ||
        openTime < Number(startTime) ||
        openTime > finalTime
      ) {
        continue;
      }

      const open = Number(raw[1]);
      const high = Number(raw[2]);
      const low = Number(raw[3]);
      const close = Number(raw[4]);

      const volume = Math.max(0, Number(raw[5]) || 0);

      const closeTime = Number(raw[6]);
      const tradeCount = Math.max(0, Number(raw[8]) || 0);

      /*
       * Binance Futures kline field [9] is taker buy base volume.
       *
       * We call this Buy Taker because these are aggressive buyers.
       *
       * The remainder of total volume is the passive-buy side:
       *
       * Buy Maker = Total Volume - Buy Taker
       *
       * Conceptually:
       *
       * Buy Maker = Sell Taker
       * Sell Maker = Buy Taker
       */
      const takerBuyVolume = Math.max(0, Number(raw[9]) || 0);

      const buyTaker = Math.min(takerBuyVolume, volume);

      const buyMaker = Math.max(
        0,
        volume - buyTaker
      );

      candles.push({
        time: openTime,
        closeTime,

        open,
        high,
        low,
        close,

        volume,

        buyTaker,
        buyMaker,

        trades: tradeCount
      });
    }

    const lastOpenTime = Number(rows[rows.length - 1]?.[0]);

    if (!Number.isFinite(lastOpenTime)) {
      break;
    }

    const nextCursor = lastOpenTime + intervalMs;

    if (nextCursor <= cursor) {
      break;
    }

    cursor = nextCursor;

    /*
     * If Binance returned fewer than the maximum number of candles,
     * there is normally nothing else to retrieve.
     */
    if (rows.length < maxLimit) {
      break;
    }
  }

  candles.sort((a, b) => a.time - b.time);

  /*
   * Remove accidental duplicate candles caused by pagination.
   */
  const unique = [];
  let previousTime = null;

  for (const candle of candles) {
    if (candle.time === previousTime) {
      continue;
    }

    unique.push(candle);
    previousTime = candle.time;
  }

  return unique;
}

export {
  normalizeSymbol,
  resolveSymbol,
  get24hTicker,
  getHistoricalKlines,
  getKlineIntervalMilliseconds
};

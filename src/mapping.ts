import { BigDecimal, BigInt, cosmos } from "@graphprotocol/graph-ts";

import { Token, Candle, Pair, Swap } from "../generated/schema";
import { DENOM_NAME_MAPPING } from "./denoms";
import { CandleSize } from "./types";

const USDC_OSMO_POOL = 678;
const USDC_DENOM = "ibc/D189335C6E4A68B513C10AB227BF1C1D38C746766278BA3EEB4FB14124F1D858";
const CANDLE_SIZES: CandleSize[] = [
  {
    interval: "5m",
    timeframe: "minute",
    divisor: 5
  },
  {
    interval: "15m",
    timeframe: "minute",
    divisor: 15
  },
  {
    interval: "30m",
    timeframe: "minute",
    divisor: 30
  },
  {
    interval: "1h",
    timeframe: "hour",
    divisor: 1
  },
  {
    interval: "4h",
    timeframe: "hour",
    divisor: 4
  },
  {
    interval: "8h",
    timeframe: "hour",
    divisor: 8
  },
  {
    interval: "12h",
    timeframe: "hour",
    divisor: 12
  },
  {
    interval: "1d",
    timeframe: "day",
    divisor: 1
  }
];

/**
 * This function is called by TheGraph for each swap event on Osmosis
 * Within this we track tokens, swaps, pairs, and candlestick data
 * 
 * @param data The event data
 */
export function handleSwap(data: cosmos.EventData): void {

  // Capture the tokens for this swap
  const tokenIn = createToken(data.event.getAttributeValue("tokens_in"));
  const tokenOut = createToken(data.event.getAttributeValue("tokens_out"));

  // Capture the pair
  const pair = createPair(tokenIn, tokenOut, data.event.getAttributeValue("pool_id"));

  // Capture the swap
  const swap = createSwap(tokenIn, tokenOut, data);

  // Create candles for the given intervals
  createCandles(swap, pair, tokenOut, data, CANDLE_SIZES);

  // Create token <> usdc candles
  createUSDCCandles(tokenIn, data, CANDLE_SIZES);
}


/**
 * Create candles for all the given sizes
 * 
 * @param swap The swap entity
 * @param pair The pair entity 
 * @param quoteAsset The quote asset for the pair
 * @param data The event data
 * @param sizes The candle sizes to create
 */
function createCandles(swap: Swap, pair: Pair, quoteAsset: Token, data: cosmos.EventData, sizes: CandleSize[]): void {
  for (let i = 0; i < sizes.length; i++) {
    createCandle(swap, pair, quoteAsset, data, sizes[i]);
  }
}

/**
 * Create token <> USDC and USDC <> token candles
 * 
 * @param tokenIn The token to create candles for
 * @param data The event data
 * @param candleSizes The candle sizes to create
 * @returns 
 */
function createUSDCCandles(tokenIn: Token, data: cosmos.EventData, candleSizes: CandleSize[]): void {
  // Create additional candles for every token vs USDC

  // Get the timestamp for the start of the 1d candle
  const dayCandleTime = getInterval(data.block.header.time.seconds, "day", 1);
  // Day candles are stored with the ID poolID-timestamp-denom-1d

  // Calculate the price of tokenIn as USDC
  // If tokenIn is USDC then the price is 1
  let tokenInPriceInUsdc = BigDecimal.fromString("1.0");
  if (tokenIn.symbol != "USDC") {

    // Get the latest candle for tokenIn <> OSMO
    const tokenInOsmoCandle = Candle.load(`${data.event.getAttributeValue("pool_id")}-${dayCandleTime}-uosmo-1d`);
    if (tokenInOsmoCandle === null) {
      // We can't get the price if we have no tokenIn <> OSMO price, this should
      // be very very rare
      return;
    }

    // Get the Osmo price in USDC
    const osmoUsdcCandle = Candle.load(`${USDC_OSMO_POOL}-${dayCandleTime}-uosmo-1d`);
    if (osmoUsdcCandle === null) {
      // We can't get the price if we have no USDC <> OSMO price, this should
      // be very very rare
      return;
    }

    // Calculate the price of tokenIn in USDC
    tokenInPriceInUsdc = tokenInOsmoCandle.close.times(osmoUsdcCandle.close);

    // Add tokenUSD price to tokenIn entity and save
    tokenIn.priceUSD = tokenInPriceInUsdc.toString();
    tokenIn.save();


    // Add candles for tokenIn <> USDC
    for (let i = 0; i < candleSizes.length; i++) {
      createCandleWithRate(tokenIn.denom, USDC_DENOM, tokenInPriceInUsdc, BigDecimal.zero(), data, candleSizes[i]);
    }

    // Add candles for USDC <> tokenIn
    const usdcPriceInTokenIn = BigDecimal.fromString("1.0").div(tokenInPriceInUsdc);
    for (let i = 0; i < candleSizes.length; i++) {
      createCandleWithRate(USDC_DENOM, tokenIn.denom, usdcPriceInTokenIn, BigDecimal.zero(), data, candleSizes[i]);
    }
  }
}

/**
 * Create candles for the required timeframes
 * 
 * @param swap The swap entity
 * @param pair The pair entity 
 * @param quoteAsset The quote asset for the pair
 * @param data The event data
 * @param size The candle size to create
 */
function createCandle(swap: Swap, pair: Pair, quoteAsset: Token, data: cosmos.EventData, size: CandleSize): void {

  const blockTime = data.block.header.time.seconds;
  const poolId = data.event.getAttributeValue("pool_id");

  const baseAmount = swap.tokenInAmount as BigInt || BigInt.zero();
  const baseDenom = pair.baseAsset;
  const quoteAmount = swap.tokenOutAmount as BigInt || BigInt.zero();
  const quoteDenom = pair.quoteAsset;

  const quoteDecimals = quoteAsset.decimals || "6";
  const rate = parseFloat(quoteAmount.toString()) / parseFloat(baseAmount.toString());
  const rateDecimal = BigDecimal.fromString(rate.toString());
  const volume = parseFloat(quoteAmount.toString()) / Math.pow(10, parseInt(quoteDecimals, 10));

  const candleTime = getInterval(blockTime, size.timeframe, i32(size.divisor));
  const candleId = `${poolId}-${candleTime}-${quoteDenom}-${size.interval}`;

  let candle = Candle.load(candleId);
  if (candle === null) {
    candle = new Candle(candleId);
    candle.poolId = poolId;
    candle.interval = size.interval;
    candle.timestamp = BigInt.fromString(candleTime.toString());
    candle.base = baseDenom;
    candle.quote = quoteDenom;
    candle.open = rateDecimal;
    candle.high = rateDecimal;
    candle.low = rateDecimal;
    candle.close = rateDecimal;
    candle.volume = BigDecimal.fromString(volume.toString());
  } else {
    if (rateDecimal.gt(candle.high)) {
      candle.high = rateDecimal;
    }
    if (rateDecimal.lt(candle.low)) {
      candle.low = rateDecimal;
    }
    candle.close = rateDecimal;
    candle.volume = candle.volume.plus(BigDecimal.fromString(volume.toString()));
  }
  candle.save();
}

/**
 * Create candles for the required timeframes with the given rate
 * 
 * @param baseAssetDenom The base asset denom
 * @param quoteAssetDenom The quote asset denom
 * @param rate The rate for baseAssetDenom in quoteAssetDenom
 * @param volume The volume for the candle
 * @param data The event data
 * @param size The candle size to create
 */
function createCandleWithRate(baseAssetDenom: string, quoteAssetDenom: string, rate: BigDecimal, volume: BigDecimal, data: cosmos.EventData, size: CandleSize): void {

  const blockTime = data.block.header.time.seconds;
  const poolId = `calc-${baseAssetDenom}-${quoteAssetDenom}`;

  const candleTime = getInterval(blockTime, size.timeframe, i32(size.divisor));
  const candleId = `calc-${baseAssetDenom}-${candleTime}-${quoteAssetDenom}-${size.interval}`;
  // console.info(`Adding custom candle ${candleId}`);
  let candle = Candle.load(candleId);
  if (candle === null) {
    candle = new Candle(candleId);
    candle.poolId = poolId;
    candle.interval = size.interval;
    candle.timestamp = BigInt.fromString(candleTime.toString());
    candle.base = baseAssetDenom;
    candle.quote = quoteAssetDenom;
    candle.open = rate;
    candle.high = rate;
    candle.low = rate;
    candle.close = rate;
    candle.volume = volume;
  } else {
    if (rate.gt(candle.high)) {
      candle.high = rate;
    }
    if (rate.lt(candle.low)) {
      candle.low = rate;
    }
    candle.close = rate;
    candle.volume = candle.volume.plus(volume);
  }
  candle.save();
}

/**
 * Create a new swap record
 * 
 * @param tokenIn The token that was swapped in
 * @param tokenOut The token that was swapped out
 * @param data The event data
 */
function createSwap(tokenIn: Token, tokenOut: Token, data: cosmos.EventData): Swap {
  const height = data.block.header.height;
  const sender = data.event.getAttributeValue("sender");
  const poolId = data.event.getAttributeValue("pool_id");

  const amountIn = extractNumberFromString(data.event.getAttributeValue("tokens_in"));
  const amountOut = extractNumberFromString(data.event.getAttributeValue("tokens_out"));

  let swap = new Swap(`${height}-${sender}`);
  swap.height = BigInt.fromString(height.toString());
  swap.sender = sender;
  swap.poolId = poolId;
  swap.tokenIn = tokenIn.denom;
  swap.tokenInAmount = BigInt.fromString(amountIn);
  swap.tokenOut = tokenOut.denom;
  swap.tokenOutAmount = BigInt.fromString(amountOut);
  swap.save();

  return swap;
}

/**
 * Create a new token based on the denom if it doesn't exist
 * Otherwise return the existing token
 * 
 * @param tokensSwappedData The data for the swap, format is {amount}{denom}. Example: 1234uosmo
 * @returns The created or existing token
 */
function createToken(tokensSwappedData: string): Token {
  const denom = getDenom(tokensSwappedData);
  let token = Token.load(denom);
  if (token === null) {
    token = new Token(denom);
  }
  token.name = getName(token.denom);
  token.denom = denom;
  token.symbol = getSymbol(token.denom);
  token.save();

  return token as Token;
}

/**
 * Create a new pair based on base and quote tokens. If it doesn't exist
 * a new pair will be created in both directions
 * 
 * @param base The base token
 * @param quote The quote token
 * @returns The created or existing pair
 */
function createPair(base: Token, quote: Token, poolId: string): Pair {

  let pair = Pair.load(`${base.denom}-${quote.denom}-${poolId}`);
  if (pair === null) {
    pair = new Pair(`${base.denom}-${quote.denom}-${poolId}`);
  }
  pair.symbol = `${base.symbol}-${quote.symbol}`;
  pair.baseAsset = base.denom;
  pair.quoteAsset = quote.denom;
  pair.name = `${base.name} - ${quote.name}`;
  pair.poolId = poolId;
  pair.save();

  // Since we're dealing with an AMM, the reverse of this is also possible
  let reversePair = Pair.load(`${quote.denom}-${base.denom}`);
  if (reversePair === null) {
    reversePair = new Pair(`${quote.denom}-${base.denom}`);
  }
  reversePair.symbol = `${quote.symbol}-${base.symbol}`;
  reversePair.baseAsset = quote.denom;
  reversePair.quoteAsset = base.denom;
  reversePair.name = `${quote.name} - ${base.name}`;
  reversePair.save();

  return pair;
}

/**
 * Get the candle interval for a given timestamp and divisor
 * 
 * @param timestamp The block timestamp
 * @param divisor The interval in seconds
 * @returns 
 */
function getInterval(timestamp: i64, timeframe: string, divisor: i32): i64 {
  const date = new Date(timestamp * 1000);
  if (timeframe == "minute") {
    const minutes = date.getUTCMinutes();
    const minutesToPreviousInterval = minutes - (minutes % divisor);
    date.setUTCMinutes(minutesToPreviousInterval);
    date.setUTCSeconds(0);
    return date.getTime() / 1000;
  }
  if (timeframe == "hour") {
    const hours = date.getUTCHours();
    const hoursToPreviousInterval = hours - (hours % divisor);
    date.setUTCHours(hoursToPreviousInterval);
    date.setUTCMinutes(0);
    date.setUTCSeconds(0);
    return date.getTime() / 1000;
  }
  if (timeframe == "day") {
    date.setUTCHours(0);
    date.setUTCMinutes(0);
    date.setUTCSeconds(0);
    return date.getTime() / 1000;
  }
  return 0;

}

/**
 * Extract the denomination from the input string
 * 
 * @param data The string to extract the denomination from 
 * @returns The denomination
 */
function getDenom(data: string): string {
  let tokenDenomLength = data.includes('ibc') ? 68 : data.includes('uion') ? 4 : 5 // IBC denomination is 68 characters long, uosmo is 5 characters long.
  return data.substring(data.length - tokenDenomLength, data.length);

}

/**
 * Get the name of a given denom based on the known denom list
 * 
 * @param denom The denom to get the name for
 * @returns The name of the denom or the denom itself if no name is found 
 */
function getName(denom: string): string {
  if (DENOM_NAME_MAPPING.has(denom)) {
    return DENOM_NAME_MAPPING.get(denom).name;
  }
  return denom;
}

/**
 * Get the symbol of a given denom based on the known denom list
 * 
 * @param denom The denom to get the name for
 * @returns The symbol of the denom or the denom itself if no name is found 
 */
function getSymbol(denom: string): string {
  if (DENOM_NAME_MAPPING.has(denom)) {
    return DENOM_NAME_MAPPING.get(denom).symbol;
  }
  return denom;
}

/**
 * Reads all the numbers from the start of input until it reaches a non-numeric
 * character, then returns the number as a string.
 * (seems regular expressions aren't supported)
 * 
 * @param input The string to extract the number from
 * @returns The number as a string, or "0" if no number was found
 */
function extractNumberFromString(input: string): string {
  let extractedNumber = "";
  for (let i = 0; i < input.length; i++) {
    const ch: string = input[i];
    if (ch >= "0" && ch <= "9") {
      extractedNumber += ch;
    } else if (extractedNumber !== "") {
      // Non-digit character found, so we've reached the end of the number
      break;
    }
  }

  if (extractedNumber !== "") {
    const result = I64.parseInt(extractedNumber, 10);
    if (isNaN(result)) {
      return "0";
    }
    return result.toString();
  }
  return "0";
}
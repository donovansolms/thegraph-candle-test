import { BigDecimal, BigInt, cosmos } from "@graphprotocol/graph-ts";

import { Token, Candle, Pair, Swap } from "../generated/schema";
import { DENOM_NAME_MAPPING } from "./denoms";
import { CandleSize } from "./types";

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
  createCandles(swap, pair, tokenOut, data, [
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
  ]);
}


/**
 * Create candles for all the given sizes
 * 
 * @param sizes A map of candle sizes to index
 */
function createCandles(swap: Swap, pair: Pair, quoteAsset: Token, data: cosmos.EventData, sizes: CandleSize[]): void {
  for (let i = 0; i < sizes.length; i++) {
    createCandle(swap, pair, quoteAsset, data, sizes[i]);
  }
}

/**
 * Create candles for the required timeframes
 * 
 * @param data 
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
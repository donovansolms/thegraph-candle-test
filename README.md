# Osmosis Candles

This subgraph creates several different candles from Osmosis swaps to be
able to chart the prices of tokens using [TheGraph](https://thegraph.com/)

Together with the candles it also builds a collection of pairs, tokens as well
as the raw swap information.

## Building

You'll the TheGraph's CLI, instructions can be found here: https://thegraph.com/docs/en/cookbook/quick-start/

```sh
graph build
graph deploy YOUR_HOSTED_ENDPOINT --product hosted-service --access-token YOUR_ACCESS_TOKEN
```

If you update `schema.graphql` and run `graph codegen` you'll need to update the
`Token` class's constructor to include additional parameters such that it looks
similar to below.

```assemblyscript
constructor(id: string, name: string = "", symbol: string = "", decimals: string = "6") {
  super();
  this.set("id", Value.fromString(id));
  this.set("name", Value.fromString(name));
  this.set("symbol", Value.fromString(symbol));
  this.set("denom", Value.fromString(id));
  this.set("decimals", Value.fromString(decimals));
}
```

Note: This might be changed in future to no longer require custom changes to 
generated types.


## Sample queries

To retrieve all the tokens captured.

```graphql
{
  tokens {
    id
    name
    denom
    symbol
    decimals
  }
}
```

To retrieve ATOM without needing the IBC denom.

```graphql
{
  tokens(where:{symbol:"ATOM"}) {
    id
    name
    denom
    symbol
    decimals
  }
}
```

To retrieve all the pairs captured.

```graphql
{
  pairs {
    id
    name
    symbol
    baseAsset
    quoteAsset
  }
}
```

To retrieve the ATOM-OSMO pairs without needing IBC denoms.

```graphql
{
  pairs(where:{symbol:"ATOM-OSMO"}) {
    id
    name
    symbol
    baseAsset
    quoteAsset
  }
}
```

To retrieve the 5-minute candles for ATOM-OSMO pair in pool 1.

Candle sizes available:

5m
15m
30m
1h
4h
8h
12h
1d

```graphql
{
  candles(where: {
    	base:"ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2"
    	quote: "uosmo",
      poolId: "1",
  		interval: "5m"
  	}) {
    id
    interval
    timestamp
    open
    high
    low
    close
    volume
  }
}
```

# Feed Provider API

FTSO protocol data provider service obtains feed values for a specific `votingRoundId` through two routes.
- `POST /preparePriceFeeds/:votingRoundId`
- `GET /preparePriceFeed/:votingRoundId:/:feedName`

The POST requests expects the following JSON in the body:

```json
{
  feeds: string[];
}
```

The response is in from:
```json
{
  votingRoundId: number;
  feedPriceData: FeedPriceData[];
}
```

Where `FeedPriceData` is in form 
```json
{
  feed: string;
  price: number;
}
```
The response correct response has code 200. 
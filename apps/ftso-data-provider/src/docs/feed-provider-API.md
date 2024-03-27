# Feed Value Provider API

FTSO protocol data provider service obtains feed values for a specific `votingRoundId` through two routes.

- `POST /feed-values/:votingRoundId`
- `GET /feed-value/:votingRoundId:/:feedId`

The POST request expects the following JSON in the body:

```json
{
  feeds: FeedId[]
}
```

Where `FeedId` is defined as:

```json
{
  type: number,
  name: string
}
```

The response object contains:

```json
{
  votingRoundId: number,
  feedValueData: FeedValueData[]
}
```

Where `FeedValueData` is defined as:

```json
{
  feed: FeedId,
  value: number
}
```

The response code for successful responses is 200.

# Data provider API interface

Protocol data providers provide the following GET routes called with the parameter `votingRoundId` and the relevant address through which the entity that is running Flare Systems Client will be sending the data to the blockchain.

- `GET submit1/:votingRoundId/:submitAddress`
- `GET submit2/:votingRoundId/:submitAddress`
- `GET submitSignatures/:votingRoundId/:submitSignaturesAddress`
- `GET submit3/:votingRoundId/:submitAddress`

The routes return the following responses

```json
{
	status: "OK",
	data: “0x12344…”,
	additionalData: “0x2345…”
}
```

In both responses status can be `"OK"` (and `data` is provided as hex encoded byte sequence, while `additionalData` is optional, also hex encoded byte sequence) or `"NOT_AVAILABLE"` (data and additionalData fields are empty) and HTTP status is 200. In case of any other error the HTTP code is relevant non 2xx code.
Note that protocol data providers are designed to be voter identity agnostic. This implies that no addresses or private keys are needed for running the Protocol data providers and they should provide the response only using the parameters provided in the call (`votingRoundId` and relevant sending address). However, data providers receive voting round id and voter’s signing address as request parameters, which can be used to produce specific responses. On the other hand, the Protocol manager as a part of the Flare System Client contains all relevant voter identity configurations, including private keys for signing.

## `finalizationData`

The `submitSignatures` response carries a third field:

```json
{
	"status": "OK",
	"data": "0x64…",
	"finalizationData": "0x1234…2345…"
}
```

It is what the Relay contract requires after the signatures: 32 bytes of the random number followed by one 32-byte word per Merkle proof node. The finalizer receives it with the message it belongs to, so finalizing needs no request of its own, and unlike `additionalData` it never enters the caller's own transaction. Absent when it could not be produced; the message is still signed and submitted.

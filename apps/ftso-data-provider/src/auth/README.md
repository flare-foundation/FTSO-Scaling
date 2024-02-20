# Auth

For auth purposes, we use NestJS building passport lib (https://docs.nestjs.com/recipes/passport).

We use a very simple strategy called passport-headerapikey (https://www.passportjs.org/packages/passport-headerapikey/).
Api keys are set in .env file and extracted at runtime. To add or modify the api keys, the server has to be restarted.

Provide api keys as comma separated string to `DATA_PROVIDER_CLIENT_API_KEYS` in .env file.

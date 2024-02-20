# Auth

For auth purposes we use nestjs building passport lib (https://docs.nestjs.com/recipes/passport)

we use a very simple strategy called passport-headerapikey (https://www.passportjs.org/packages/passport-headerapikey/)

Api keys are set in .env file and extracted ad runtime. So if you want to add or modify the api key you will have to restart your server.

provide api keys as comma separated string to `DATA_PROVIDER_CLIENT_API_KEYS`

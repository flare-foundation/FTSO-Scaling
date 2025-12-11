# Contributing

This document describes the process of contributing to this project. It is
intended for anyone considering opening an issue or pull request.

## AI Assistance

Any significant use of the AI assistance in the contribution MUST be disclosed in the pull request along with the extent of the use.

An example disclosure:

> This PR was written primarily by Claude Code.

Or a more detailed disclosure:

> I consulted ChatGPT for the following code snippets: ...

## Quick start

If you'd like to contribute, report a bug, suggest a feature or you've
implemented a feature you should open an issue or pull request.

Any contribution to the project is expected to contain code that is formatted,
linted and that the existing tests still pass. Adding unit tests for new code is
also welcome.

## Dev environment

Prerequisites:

- Node.js, as specified in the `.nvmrc` file. We recommend using `nvm` to manage versions.
- Yarn 1.22.x
- Git

Install the dependencies:

```bash
$ yarn install
```

### Configuration

Copy `.env.example` to `.env` and fill the required configuration parameters.


### Running the FTSO data provider client app

To start the app run:

```bash
# development
$ yarn run start

# watch mode
$ yarn run start:dev
```

### Testing

To run all tests or check code coverage, use the following commands:
```bash
yarn test:all
yarn test:coverage
```
### Linting and formatting

We use ESLint and Prettier:
- Check lint:

  ```bash
  yarn lint:check
  ```

- Auto-fix lint issues:

  ```bash
  yarn lint:fix
  ```

- Check formatting:

  ```bash
  yarn format:check
  ```

- Auto-format:

  ```bash
  yarn format:fix
  ```
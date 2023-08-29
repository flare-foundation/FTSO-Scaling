# FTSO Scaling protocol

This repo contains MVP of an implementation of the new FTSO Scaling protocol.

# Setup

### Node.JS

- Install [NVM](https://github.com/nvm-sh/nvm).
- Install Node v18 (LTS): 
```
nvm install 18
```
- Set as version 18 as default: 
```
nvm alias default 18
```

### Project

- Install `ts-node`: (will be needed for running scripts)
```
npm install -g ts-node
```
- Install `yarn`: 
```
npm install -g yarn
```
- To compile smart contracts run:
```
yarn c
```
- To run all tests run:
```
yarn test
```

Recommeded editor to use is [VSCode](https://code.visualstudio.com/).

## Code formatting

We use `Prettier` for code formatting, with settings defined under `package.json`.

You can install the VSCode extension and use the shortcut `Alt/Option` + `Shift` + `F` to auto-format the current file.

module.exports = {
  skipFiles: [
    'mock/Imports.sol'
  ],
  istanbulReporter: ['html', 'text', 'cobertura'],
  istanbulFolder: './coverage/sol'
};
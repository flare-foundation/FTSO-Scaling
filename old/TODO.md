- Publishing random with quality (number of missed reveals)
- How to address low turnout.
  - require certain turnout on offers
  - have all voters defined prior to each reward epoch, and their weights, total weight
  - do filtering of the commit/reveals based on the eligible votersx
  - add signed weight in publication of the price
- Incentives:
  - for fast signing and publication (incentive for as many as possible weight as fast as possible)
  - punishing missed reveals
- Snapshoting weights for reward epoch on the reward contract
  - deamonized (using voter whitelister at the time of the call)
  - the best random for the last few reward epochs is used.
  - order of voters is determined by copying the list of addresses of voterWhitelister
  - truncated weight used to compete for rewards
  - weights for rewarding
- Check the reward contract fixes are ok

# General
- How to integrate Web Connector protocol.
- Claiming could be done through a separate contract, that is topped up through a reward contract.
- Code should be commented better. Maybe a bit refactored for easier use.
- Web3 library provider should be implemented and FTSO client enabled for real time use. Needed for deployment on Coston. Implement scheduling of jobs. Add configurations.
- Real price feeds integration must be done. Use FTSO provider by Flare. Implement plugable price feeds.
- Deployment code scripts
- Docs folder. Mirror the documentation from google docs to the repo.


// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import '@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol';
import '@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol';
import '@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol';
import '../interfaces/periphery/INonfungibleTokenPositionDescriptor.sol';

contract TokenPositionDescriptor is
  INonfungibleTokenPositionDescriptor,
  Initializable,
  UUPSUpgradeable,
  OwnableUpgradeable
{
  string private tokenUri;

  function initialize() public initializer {
    __Ownable_init();
  }

  function _authorizeUpgrade(address) internal override onlyOwner {}

  function setTokenUri(string memory _tokenUri) external onlyOwner {
    tokenUri = _tokenUri;
  }

  function tokenURI(IBasePositionManager, uint256) external view override returns (string memory) {
    return tokenUri;
  }
}

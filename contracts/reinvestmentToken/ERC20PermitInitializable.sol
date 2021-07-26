// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

import {ERC20Initializable} from './ERC20Initializable.sol';
import '../interfaces/IERC20Permit.sol';

/// @dev https://eips.ethereum.org/EIPS/eip-2612
contract ERC20PermitInitializable is ERC20Initializable, IERC20Permit {
  /// @dev To make etherscan auto-verify new pool, this variable is not immutable
  bytes32 public domainSeparator;
  // keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");
  bytes32 public constant PERMIT_TYPEHASH =
    0x6e71edae12b1b97f4d1f60370fef10105fa2faae0126114a169c64845d6126c9;

  mapping(address => uint256) public nonces;

  function initialize(
    string memory name,
    string memory symbol,
    string memory version
  ) public {
    ERC20Initializable.initialize(name, symbol);
    uint256 chainId;
    assembly {
      chainId := chainid()
    }
    domainSeparator = keccak256(
      abi.encode(
        keccak256(
          'EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'
        ),
        keccak256(bytes(name)),
        keccak256(bytes(version)),
        chainId,
        address(this)
      )
    );
  }

  function permit(
    address owner,
    address spender,
    uint256 value,
    uint256 deadline,
    uint8 v,
    bytes32 r,
    bytes32 s
  ) external override {
    require(deadline >= block.timestamp, 'ERC20Permit: EXPIRED');
    bytes32 digest = keccak256(
      abi.encodePacked(
        '\x19\x01',
        domainSeparator,
        keccak256(abi.encode(PERMIT_TYPEHASH, owner, spender, value, nonces[owner]++, deadline))
      )
    );
    address recoveredAddress = ecrecover(digest, v, r, s);
    require(
      recoveredAddress != address(0) && recoveredAddress == owner,
      'ERC20Permit: INVALID_SIGNATURE'
    );
    _approve(owner, spender, value);
  }
}

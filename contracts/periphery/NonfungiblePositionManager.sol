// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.4;
pragma abicoder v2;

// import {ERC721Enumerable, ERC721} from '@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol';
import {INonfungiblePositionManager} from '../interfaces/periphery/INonfungiblePositionManager.sol';
import {IERC20, IProAMMPool, IProAMMFactory} from '../interfaces/IProAMMPool.sol';
import {LiquidityHelper, ImmutableRouterStorage} from './base/LiquidityHelper.sol';
import {Multicall} from './base/Multicall.sol';
import {DeadlineValidation} from './base/DeadlineValidation.sol';


contract NonfungiblePositionManager is
  INonfungiblePositionManager,
  Multicall,
  LiquidityHelper,
  DeadlineValidation
{
  struct Position {
    // the nonce for permits
    uint96 nonce;
    // the address that is approved for spending this token
    address operator;
    // the ID of the pool with which this token is connected
    uint80 poolId;
    // the tick range of the position
    int24 tickLower;
    int24 tickUpper;
    // the liquidity of the position
    uint128 liquidity;

    uint256 feeGrowthInsideLast;
  }

  struct PoolInfo {
    address token0;
    uint16 fee;
    address token1;
  }

  mapping (address => uint80) private _addressToPoolId;
  mapping (uint80 => PoolInfo) private _poolInfoById;
  uint80 private _nextPoolId = 1;
  uint256 private _nextTokenId = 1;

  mapping (uint256 => Position) private _positions;

  constructor(address _factory, address _WETH) // ERC721('ProAMM NFT Positions V1', 'PRO-AMM-POS-V1') 
    ImmutableRouterStorage(_factory, _WETH) {}

  function createAndUnlockPoolIfNecessary(
    address token0,
    address token1,
    uint16 fee,
    uint160 sqrtPriceX96
  ) external payable override returns (address pool) {
    require(token0 < token1);
    pool = IProAMMFactory(factory).getPool(token0, token1, fee);

    if (pool == address(0)) {
      pool = IProAMMFactory(factory).createPool(token0, token1, fee);
    }

    (uint160 poolSqrtPriceX96, , , ) = IProAMMPool(pool).getPoolState();
    if (poolSqrtPriceX96 == 0) {
      IProAMMPool(pool).unlockPool(sqrtPriceX96, _callbackData(token0, token1, fee));
    }
  }

  function mint(MintParams calldata params)
    external
    payable
    onlyNotExpired(params.deadline)
    returns (
      uint256 tokenId,
      uint128 liquidity,
      uint256 amount0,
      uint256 amount1
    )
  {
    IProAMMPool pool;
  
    (liquidity, amount0, amount1, pool) = addLiquidity(AddLiquidityParams({
      token0: params.token0, token1: params.token1, fee: params.fee, recipient: params.recipient,
      tickLower: params.tickLower, tickUpper: params.tickUpper,
      amount0Desired: params.amount0Desired, amount1Desired: params.amount1Desired,
      amount0Min: params.amount0Min, amount1Min: params.amount1Min
    }));

    uint256 tokenId = _nextTokenId++;
    // TODO: mint new nft with tokenId

    bytes32 positionKey = _positionKey(params.tickLower, params.tickUpper);
    (, uint256 feeGrowthInsideLast) = pool.positions(positionKey);
    uint80 poolId = _storePoolInfo(address(pool), PoolInfo({ token0: params.token0, fee: params.fee, token1: params.token1 }));

    _positions[tokenId] = Position({
      nonce: 0,
      operator: address(0),
      poolId: poolId,
      tickLower: params.tickLower,
      tickUpper: params.tickUpper,
      liquidity: liquidity,
      feeGrowthInsideLast: feeGrowthInsideLast
    });

    // TODO: Emit event
  }

  function addLiquidity(IncreaseLiquidityParams calldata params)
    external
    payable
    onlyNotExpired(params.deadline)
    returns (
      uint128 liquidity,
      uint256 amount0,
      uint256 amount1
    )
  {
    
  }

  function _storePoolInfo(address pool, PoolInfo memory info) private returns (uint80 poolId) {
    poolId = _addressToPoolId[pool];
    if (poolId == 0) {
      _addressToPoolId[pool] = (poolId = _nextPoolId++);
      _poolInfoById[poolId] = info;
    }
  }

  function _positionKey(uint24 tickLower, uint24 tickUpper) internal returns (bytes32) {
    return keccak256(abi.encodePacked(address(this), tickLower, tickUpper));
  }

  // modifier isAuthorizedForToken(uint256 tokenId) {
  //   require(_isApprovedOrOwner(msg.sender, tokenId), 'Not approved');
  //   _;
  // }

  // function tokenURI(uint256 tokenId) public view override(ERC721, IERC721Metadata) returns (string memory) {
  //   require(_exists(tokenId));
  //   return INonfungibleTokenPositionDescriptor(_tokenDescriptor).tokenURI(this, tokenId);
  // }

  // // save bytecode by removing implementation of unused method
  // function baseURI() public pure override returns (string memory) {}
}

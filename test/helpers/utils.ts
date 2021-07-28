import bn from 'bignumber.js';
import {ethers} from 'hardhat';
import {BigNumber, BigNumberish} from 'ethers';
import {MockTickMath} from '../../typechain/MockTickMath';
import {MIN_TICK, MAX_TICK} from './helper';

bn.config({EXPONENTIAL_AT: 999999, DECIMAL_PLACES: 40});

export {BigNumber} from 'ethers';

export const getMinTick = (tickSpacing: number) => Math.ceil(MIN_TICK.toNumber() / tickSpacing) * tickSpacing
export const getMaxTick = (tickSpacing: number) => Math.floor(MAX_TICK.toNumber() / tickSpacing) * tickSpacing

export function encodePriceSqrt(reserve1: BigNumberish, reserve0: BigNumberish): BigNumber {
  return BigNumber.from(
    new bn(reserve1.toString())
      .div(reserve0.toString())
      .sqrt()
      .multipliedBy(new bn(2).pow(96))
      .integerValue(3)
      .toString()
  );
}

export async function getNearestSpacedTickAtPrice(sqrtRatio: BigNumber, tickSpacing: number): Promise<BigNumber> {
  return BigNumber.from(Math.ceil((await _getTickAtPrice(sqrtRatio)) / tickSpacing) * tickSpacing)
}

export async function getTickAtPrice(sqrtRatio: BigNumber): Promise<BigNumberish> {
  return BigNumber.from(_getTickAtPrice(sqrtRatio));
}

export async function getPriceFromTick(tick: BigNumberish) {
  return await (await deployTickMath()).getSqrtRatioAtTick(tick);
}

export function getPositionKey(owner: string, tickLower: BigNumberish, tickUpper: BigNumberish) {
  return ethers.utils.solidityKeccak256(['address', 'int24', 'int24'], [owner, tickLower, tickUpper]);
}

async function _getTickAtPrice(sqrtRatio: BigNumber): Promise<number> {
  return await (await deployTickMath()).getTickAtSqrtRatio(sqrtRatio);
}

async function deployTickMath() {
  return (await (await ethers.getContractFactory('MockTickMath')).deploy()) as MockTickMath;
}

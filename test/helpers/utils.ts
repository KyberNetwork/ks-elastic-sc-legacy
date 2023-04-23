import bn from 'bignumber.js';
import {ethers} from 'hardhat';
import {TransactionResponse} from '@ethersproject/abstract-provider';
import {BigNumber as BN, BigNumberish} from 'ethers';
import {MockTickMath} from '../../typechain/MockTickMath';
import {MIN_TICK, MAX_TICK, ZERO_ADDRESS} from './helper';
import {expect} from 'chai';
import {utils} from 'ethers';

bn.config({EXPONENTIAL_AT: 999999, DECIMAL_PLACES: 40});

export const getMinTick = (tickDistance: number) => Math.ceil(MIN_TICK.toNumber() / tickDistance) * tickDistance;
export const getMaxTick = (tickDistance: number) => Math.floor(MAX_TICK.toNumber() / tickDistance) * tickDistance;

export function encodePriceSqrt(reserve1: BigNumberish, reserve0: BigNumberish): BN {
  return BN.from(
    new bn(reserve1.toString())
      .div(reserve0.toString())
      .sqrt()
      .multipliedBy(new bn(2).pow(96))
      .integerValue(3)
      .toString()
  );
}

export function sqrtPToString(a: BN) {
  let sqrtP = new bn(a.toString()).dividedBy(new bn(2).pow(96));
  return sqrtP.toString();
}

export async function getNearestSpacedTickAtPrice(sqrtRatio: BN, tickDistance: number): Promise<BN> {
  return BN.from(Math.floor((await _getTickAtPrice(sqrtRatio)) / tickDistance) * tickDistance);
}

export async function getTickAtPrice(sqrtRatio: BN): Promise<BN> {
  return BN.from(_getTickAtPrice(sqrtRatio));
}

export async function getPriceFromTick(tick: BigNumberish): Promise<BN> {
  return await (await deployTickMath()).getSqrtRatioAtTick(tick);
}

async function _getTickAtPrice(sqrtRatio: BN): Promise<number> {
  return await (await deployTickMath()).getTickAtSqrtRatio(sqrtRatio);
}

async function deployTickMath(): Promise<MockTickMath> {
  return (await (await ethers.getContractFactory('MockTickMath')).deploy()) as MockTickMath;
}

import chai from 'chai';

import {jestSnapshotPlugin} from 'mocha-chai-jest-snapshot';
import {MockToken, MockToken__factory} from '../../typechain';
chai.use(jestSnapshotPlugin());

export async function snapshotGasCost(response: TransactionResponse) {
  const receipt = await response.wait();
  // expect(`${receipt.gasUsed.toString()}`).toMatchSnapshot();
}

export async function getBalances(account: string, tokens: string[]): Promise<BN[]> {
  const Token = (await ethers.getContractFactory('MockToken')) as MockToken__factory;
  let balances = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] == ZERO_ADDRESS) {
      balances.push(await ethers.provider.getBalance(account));
    } else {
      balances.push(await Token.attach(tokens[i]).balanceOf(account));
    }
  }
  return balances;
}

export function sortTokens(tokenA: string, tokenB: string): [string, string] {
  return tokenA.toLowerCase() < tokenB.toLowerCase() ? [tokenA, tokenB] : [tokenB, tokenA];
}

export function orderTokens(tokenA: MockToken, tokenB: MockToken): [MockToken, MockToken] {
  return tokenA.address.toLowerCase() < tokenB.address.toLowerCase() ? [tokenA, tokenB] : [tokenB, tokenA];
}

export function getCreate2Address(
  factoryAddress: string,
  [tokenA, tokenB, swapFeeUnits]: [string, string, number],
  bytecode: string
): string {
  const [token0, token1] = sortTokens(tokenA, tokenB);
  const params = utils.defaultAbiCoder.encode(['address', 'address', 'uint24'], [token0, token1, swapFeeUnits]);
  const create2Inputs = ['0xff', factoryAddress, utils.keccak256(params), utils.keccak256(bytecode)];
  const sanitizedInputs = `0x${create2Inputs.map((i) => i.slice(2)).join('')}`;
  return utils.getAddress(`0x${utils.keccak256(sanitizedInputs).slice(-40)}`);
}

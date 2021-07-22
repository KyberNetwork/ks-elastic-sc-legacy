import bn from 'bignumber.js';
import {BigNumber as BN, BigNumberish} from 'ethers';
import {BPS, PRECISION, TWO_POW_96} from './helper';

export function convertReserveAmtsToSqrtPrice(amount1: BigNumberish, amount0: BigNumberish): BN {
  return BN.from(
    new bn(amount1.toString())
      .div(amount0.toString())
      .sqrt()
      .multipliedBy(new bn(TWO_POW_96.toString()))
      .dividedBy(new bn('1e8'))
      .integerValue(bn.ROUND_FLOOR)
      .toString()
  ).mul(1e8);
}

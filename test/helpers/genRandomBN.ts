import {BigNumber as BN} from '@ethersproject/bignumber';
import {ONE, ZERO} from './helper';

export function genRandomSeed(base: number): number {
  return Math.floor(Math.random() * base) % base;
}

export function genRandomBN(minBN: BN, maxBN: BN) {
  let seed = BN.from(genRandomSeed(1e15));
  // normalise seed
  return maxBN.sub(minBN).mul(seed).div(1e15).add(minBN);
}

// will return ZERO (chance/100)% of the time
export function genRandomBNWithPossibleZero(chance: number, maxBN: BN) {
  let rand = genRandomSeed(100);
  return rand <= chance ? ZERO : genRandomBN(ONE, maxBN);
}

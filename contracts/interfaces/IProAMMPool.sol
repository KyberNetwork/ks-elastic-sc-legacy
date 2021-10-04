// SPDX-License-Identifier: agpl-3.0
pragma solidity >=0.8.0;

import {IProAMMPoolActions} from './pool/IProAMMPoolActions.sol';
import {IProAMMPoolEvents} from './pool/IProAMMPoolEvents.sol';
import {IPoolStorage} from './IPoolStorage.sol';

interface IProAMMPool is IProAMMPoolActions, IProAMMPoolEvents, IPoolStorage {}

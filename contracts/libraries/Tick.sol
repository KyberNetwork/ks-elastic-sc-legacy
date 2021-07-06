// SPDX-License-Identifier: agpl-3.0
pragma solidity >=0.8.0;

import {SafeCast} from './SafeCast.sol';
import {TickMath} from './TickMath.sol';
import {LiqDeltaMath} from './LiqDeltaMath.sol';

/// @title Tick
/// @notice Contains functions for managing and updating tick data
library Tick {
    using SafeCast for int256;

    // data stored for each initialized individual tick
    struct Data {
        // gross liquidity of all positions in tick
        uint128 liquidityGross;
        // liquidity quantity to be added | removed when tick is crossed up | down
        int128 liquidityNet;
        // fee growth per unit of liquidity on the other side of this tick (relative to current tick)
        // only has relative meaning, not absolute — the value depends on when the tick is initialized
        uint256 feeGrowthOutside;
        // true iff the tick is initialized, when liquidityGross != 0
        // these 8 bits are set to prevent fresh sstores when crossing newly initialized ticks
        bool initialized;
    }

    /// @notice Derives max liquidity per tick from given tick spacing
    /// @dev Executed within ProAMMPool constructor
    /// to ensure that max pool liquidity <= type(uint128).max (prevent overflow)
    /// @param tickSpacing Required tick separation
    /// e.g: a tickSpacing of 5 means ticks can be initialized every 5th tick, i.e., ..., -10, -5, 0, 5, 10, ...
    /// It remains an int24 to avoid casting even though it is >= 1
    /// @return Max liquidity per tick
    function calcMaxLiquidityPerTickFromSpacing(int24 tickSpacing) internal pure returns (uint128) {
        int24 minTick = (TickMath.MIN_TICK / tickSpacing) * tickSpacing;
        int24 maxTick = (TickMath.MAX_TICK / tickSpacing) * tickSpacing;
        uint24 numTicks = uint24((maxTick - minTick) / tickSpacing) + 1;
        return type(uint128).max / numTicks;
    }

    /// @notice Retrieves fee growth data
    /// @param self Mapping containing all tick data for initialized ticks
    /// @param tickLower Lower tick boundary of the position
    /// @param tickUpper Upper tick boundary of the position
    /// @param tickCurrent Current tick
    /// @param feeGrowthGlobal All-time global fee growth, per unit of liquidity
    /// @return feeGrowthInside All-time fee growth per unit of liquidity, inside the position's tick boundaries
    function getFeeGrowthInside(
        mapping(int24 => Tick.Data) storage self,
        int24 tickLower,
        int24 tickUpper,
        int24 tickCurrent,
        uint256 feeGrowthGlobal
    ) internal view returns (uint256 feeGrowthInside) {
        Data storage lower = self[tickLower];
        Data storage upper = self[tickUpper];

        uint256 feeGrowthBelow = (tickCurrent >= tickLower) ?
            lower.feeGrowthOutside :
            feeGrowthGlobal - lower.feeGrowthOutside;
        
        uint256 feeGrowthAbove = (tickCurrent < tickUpper) ?
            upper.feeGrowthOutside :
            feeGrowthGlobal - upper.feeGrowthOutside;
        
        feeGrowthInside = feeGrowthGlobal - feeGrowthBelow - feeGrowthAbove;
    }

    /// @notice Updates a tick and returns true if the tick was flipped from initialized to uninitialized, or vice versa
    /// @param self Mapping containing all tick data for initialized ticks
    /// @param tick Tick to be updated
    /// @param tickCurrent Current tick
    /// @param liquidityDelta Liquidity quantity to be added | removed when tick is crossed up | down
    /// @param feeGrowthGlobal All-time global fee growth, per unit of liquidity
    /// @param isLower true | false if updating a position's lower | upper tick
    /// @param maxLiquidity The maximum liquidity allocation for a single tick
    /// @return flipped Whether the tick was flipped from initialized to uninitialized, or vice versa
    function update(
        mapping(int24 => Tick.Data) storage self,
        int24 tick,
        int24 tickCurrent,
        int128 liquidityDelta,
        uint256 feeGrowthGlobal,
        bool isLower,
        uint128 maxLiquidity
    ) internal returns (bool flipped) {
        Tick.Data storage data = self[tick];

        uint128 liquidityGrossBefore = data.liquidityGross;
        uint128 liquidityGrossAfter = LiqDeltaMath.addLiquidityDelta(liquidityGrossBefore, liquidityDelta);

        require(liquidityGrossAfter <= maxLiquidity, '> max liquidity');

        flipped = (liquidityGrossAfter == 0) != (liquidityGrossBefore == 0);

        if (liquidityGrossBefore == 0) {
            // by convention, we assume that all growth before a tick was initialized happened _below_ the tick
            if (tick <= tickCurrent) data.feeGrowthOutside = feeGrowthGlobal;
            data.initialized = true;
        }

        data.liquidityGross = liquidityGrossAfter;

        // if lower tick, liquidityDelta should be added | removed when crossed up | down
        // else, for upper tick, liquidityDelta should be removed | added when crossed up | down
        data.liquidityNet = isLower ?
            data.liquidityNet + liquidityDelta :
            data.liquidityNet - liquidityDelta;
    }

    /// @notice Clears tick data
    /// @param self Mapping containing all initialized tick data for initialized ticks
    /// @param tick Tick to be cleared
    function clear(mapping(int24 => Tick.Data) storage self, int24 tick) internal {
        delete self[tick];
    }

    /// @notice Handles transition to destination tick
    /// @param self Mapping containing all tick data for initialized ticks
    /// @param tick Destination tick of the transition
    /// @param feeGrowthGlobal All-time global fee growth, per unit of liquidity
    /// @return liquidityNet liquidity quantity to be added | removed when tick is crossed up | down
    function crossToTick(
        mapping(int24 => Tick.Data) storage self,
        int24 tick,
        uint256 feeGrowthGlobal
    ) internal returns (int128 liquidityNet) {
        Tick.Data storage data = self[tick];
        data.feeGrowthOutside = feeGrowthGlobal - data.feeGrowthOutside;
        liquidityNet = data.liquidityNet;
    }
}

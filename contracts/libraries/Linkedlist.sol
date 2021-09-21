// SPDX-License-Identifier: BUSL-1.1
pragma solidity >=0.8.0;


library Linkedlist {

  struct Data {
    int24 previous;
    int24 next;
  }

  /**
   * @dev init data with the lowest and highest value of the LinkedList
   */
  function init(
    mapping(int24 => Linkedlist.Data) storage self,
    int24 lowestValue,
    int24 highestValue
  ) internal {
    (self[lowestValue].previous, self[lowestValue].next) = (lowestValue, highestValue);
    (self[highestValue].previous, self[highestValue].next) = (lowestValue, highestValue);
  }

  /**
   * @dev Remove a value from the linked list, return the lower value
   *  Return the lower value after removing, in case removedValue is the lowest/highest,
   *  no removing is done
   */
  function remove(
    mapping(int24 => Linkedlist.Data) storage self,
    int24 removedValue
  ) internal returns (int24 lowerValue) {
    Data memory removedValueData = self[removedValue];
    if (removedValueData.previous == removedValue) return removedValue; // remove the lowest value, nothing is done
    lowerValue = removedValueData.previous;
    if (removedValueData.next == removedValue) return lowerValue; // remove the highest value, nothing is done
    self[removedValueData.previous].next = removedValueData.next;
    self[removedValueData.next].previous = removedValueData.previous;
    delete self[removedValue];
  }

  /**
   * @dev Insert a new value to the linked list given its lower value that is inside the linked list
   */
  function insert(
    mapping(int24 => Linkedlist.Data) storage self,
    int24 newValue,
    int24 lowerValue
  ) internal {
    int24 nextValue = self[lowerValue].next;
    require(lowerValue < newValue && nextValue > newValue);
    self[newValue].next = nextValue;
    self[newValue].previous = lowerValue;
    self[nextValue].previous = newValue;
    self[lowerValue].next = newValue;
  }

  /**
   * @dev Return the next value in the linked list
   */
  function goNext(
    mapping(int24 => Linkedlist.Data) storage self,
    int24 fromValue
  ) internal view returns (int24) {
    return self[fromValue].next;
  }

  /**
   * @dev Return the previous value in the linked list
   */
  function goBack(
    mapping(int24 => Linkedlist.Data) storage self,
    int24 fromValue
  ) internal view returns (int24) {
    return self[fromValue].previous;
  }
}

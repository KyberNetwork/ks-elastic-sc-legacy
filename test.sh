#!/bin/sh
while getopts "f:" arg; do
  case $arg in
    f) FILE=$OPTARG;;
  esac
done

if [ -n "$FILE" ]; then
  yarn hardhat test --no-compile $FILE
else
  echo "Running all tests..."
  yarn hardhat test test/**/*.spec.* --no-compile
fi
